// =========================================================
// Google Apps Script - 診断プログラム バックエンド
// =========================================================
// 【スクリプトプロパティに設定するもの】
//   CLAUDE_API_KEY : Claude APIキー（Anthropic）
//   SHEET_ID       : スプレッドシートのID
//   NOTIFY_EMAIL   : 登録・通知先メールアドレス
// =========================================================

function getApiKey()     { return PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY'); }
function getSheetId()    { return PropertiesService.getScriptProperties().getProperty('SHEET_ID'); }
function getNotifyEmail(){ return PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL'); }

// =========================================================
// GET（死活確認用）
// =========================================================
function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ status: 'ok', message: 'GAS API is running' })
  ).setMimeType(ContentService.MimeType.JSON);
}

// =========================================================
// POST（メインエントリーポイント）
// =========================================================
function doPost(e) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    var payload = JSON.parse(e.postData.contents);
    var action  = payload.action;
    var result;

    if      (action === 'save_only' || action === 'save_only_v2')       result = handleSaveOnly(payload);
    else if (action === 'get_advice')      result = handleGetAdvice(payload);
    else if (action === 'generate_plan')   result = handleGeneratePlan(payload);
    else result = { status: 'error', message: '不明なアクション: ' + action };

    output.setContent(JSON.stringify(result));
  } catch (err) {
    console.error('診断リクエスト失敗: ' + (err.code || 'SAVE_FAILED'));
    output.setContent(JSON.stringify({ status: 'error', code: err.code || 'SAVE_FAILED',
      message: err.code ? err.message : '保存を確認できませんでした。同じ画面からもう一度お試しください。' }));
  }

  return output;
}

// =========================================================
// save_only: スプレッドシート保存 + 登録通知メール送信
// =========================================================
// Fixed questionnaire contracts; never use incoming object order as the schema.
var DIAGNOSIS_FIELDS = {
  quick: ['ビジネス・仕事', 'お金・収入', '家族関係', '健康・体力', '心の健康', '自己実現', '人間関係の質', '人生の目的'],
  full: ['ビジネス・仕事', 'お金・収入', '社会貢献', 'キャリアビジョン', '友人関係', '家族関係', 'パートナーシップ', '健康・体力', '時間の自由', '住環境', '趣味・余暇', '持ち物・環境', '心の健康', '自己実現', '創造性', '学び・成長', 'チャレンジ精神', 'ライフバランス', '人間関係の質', '信頼と安心感', '感謝の気持ち', '目標達成度', 'スピリチュアリティ', '人生の目的']
};
var SUBMISSION_ID_HEADER = '送信ID';

function saveError(code, message) {
  var error = new Error(message);
  error.code = code;
  return error;
}

function validateSubmission(payload) {
  var mode = payload.mode === undefined ? 'full' : payload.mode;
  if (mode !== 'quick' && mode !== 'full') {
    throw saveError('INVALID_INPUT', '診断モードを確認してください。');
  }
  var name = typeof payload.name === 'string' ? payload.name.trim() : '';
  var email = typeof payload.email === 'string' ? payload.email.trim() : '';
  if (!name || name.length > 200 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw saveError('INVALID_INPUT', 'お名前とメールアドレスを確認してください。');
  }
  var ratings = payload.ratings;
  var fields = DIAGNOSIS_FIELDS[mode];
  if (!ratings || typeof ratings !== 'object' || Array.isArray(ratings) || Object.keys(ratings).length !== fields.length) {
    throw saveError('INVALID_INPUT', 'すべての診断項目に回答してください。');
  }
  fields.forEach(function(field) {
    var value = ratings[field];
    if (!Object.prototype.hasOwnProperty.call(ratings, field) || !Number.isInteger(value) || value < 1 || value > 5) {
      throw saveError('INVALID_INPUT', '各項目を1〜5の整数で回答してください。');
    }
  });
  var id = payload.submissionId;
  if (id === undefined) id = '';
  else if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(id)) {
    throw saveError('INVALID_INPUT', '送信情報を確認してください。');
  }
  return { name: name, email: email, ratings: ratings, mode: mode, submissionId: id };
}

function handleSaveOnly(payload) {
  var submission = validateSubmission(payload);
  if (payload.action === 'save_only_v2' && !submission.submissionId) {
    throw saveError('INVALID_INPUT', '送信情報を確認してください。');
  }
  var saved = saveToSheet(submission);
  // Retrying an acknowledged or ambiguous save never sends a second notification.
  var notification = saved.duplicate ? 'skipped_duplicate' : sendRegistrationNotification(submission.name, submission.email, submission.mode);
  return {
    status: 'success', saved: true, duplicate: saved.duplicate,
    submissionId: submission.submissionId || null, notification: notification
  };
}

// =========================================================
// get_advice: AIアドバイス生成（Claude API使用・保存なし）
// =========================================================
function handleGetAdvice(payload) {
  var name    = payload.name    || '';
  var ratings = payload.ratings || {};
  var mode    = payload.mode    || 'full';

  var analysis = generateAnalysis(name, ratings, mode);
  return { status: 'success', analysis: analysis };
}

// =========================================================
// generate_plan: アクションプラン生成（Claude API使用）
// =========================================================
function handleGeneratePlan(payload) {
  var ratings = payload.ratings || {};
  var plan    = generateActionPlan(ratings);
  return { status: 'success', plan: plan };
}

// =========================================================
// Claude API 共通呼び出し
// =========================================================
function callClaude(prompt, maxTokens) {
  var apiKey = getApiKey();
  if (!apiKey) return '【エラー】APIキーが設定されていません。GASのスクリプトプロパティに CLAUDE_API_KEY を設定してください。';

  var url = 'https://api.anthropic.com/v1/messages';
  var requestBody = {
    model: 'claude-sonnet-4-5',
    max_tokens: maxTokens || 1024,
    messages: [{ role: 'user', content: prompt }]
  };

  try {
    var response = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      console.error('Claude APIエラー: ' + code + ' ' + response.getContentText());
      return '分析の生成に失敗しました（エラー: ' + code + '）。';
    }

    var data = JSON.parse(response.getContentText());
    return data.content[0].text;
  } catch (err) {
    return '生成中にエラーが発生しました: ' + err.message;
  }
}

// =========================================================
// 診断分析テキスト生成
// =========================================================
function generateAnalysis(name, ratings, mode) {
  var ratingsText = Object.entries(ratings).map(function(e) {
    return '・' + e[0] + ': ' + e[1] + '/5';
  }).join('\n');

  var lowScores = Object.entries(ratings).filter(function(e) {
    return e[1] <= 2;
  }).map(function(e) {
    return e[0] + '(' + e[1] + '/5)';
  });

  var prompt =
    name + ' 様の診断結果を分析してください。\n\n' +
    '【各領域の自己評価（1=全く不満足 〜 5=非常に満足）】\n' + ratingsText + '\n\n' +
    '【課題領域（スコア2以下）】\n' + (lowScores.length > 0 ? lowScores.join('、') : 'なし') + '\n\n' +
    '経営者・起業家向けの深い洞察と具体的なフィードバックを日本語で提供してください（200〜300文字程度）。\n' +
    '強みと主な課題を簡潔に伝え、' + name + ' 様に呼びかけるパーソナルな文体で書いてください。';

  return callClaude(prompt, 512);
}

// =========================================================
// アクションプラン生成
// =========================================================
function generateActionPlan(ratings) {
  var ratingsText = Object.entries(ratings).map(function(e) {
    return e[0] + ': ' + e[1] + '/5';
  }).join('、');

  var prompt =
    '以下の経営者診断スコアに基づき、具体的なアクションプランを作成してください。\n\n' +
    '【スコア】' + ratingsText + '\n\n' +
    '以下の形式で、実行可能なアクションを提案してください（300〜400文字）：\n\n' +
    '■ 今週すぐやること（1〜2つ）\n' +
    '■ 今月中に取り組むこと（2〜3つ）\n' +
    '■ 3ヶ月以内の目標（1〜2つ）\n\n' +
    '※ 具体的で実行しやすい内容にしてください。';

  return callClaude(prompt, 512);
}

// =========================================================
// スプレッドシート保存（モード別シートに保存）
// =========================================================
function sheetHeaders(sheet) {
  if (!sheet || sheet.getLastRow() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function assertHeaders(headers, fields) {
  var required = ['日時', '氏名', 'メール', 'モード'].concat(fields).concat(['平均']);
  required.forEach(function(field) {
    if (headers.indexOf(field) < 0 || headers.indexOf(field) !== headers.lastIndexOf(field)) {
      throw saveError('SCHEMA_MISMATCH', '集計シートの項目を確認する必要があります。管理者へお問い合わせください。');
    }
  });
  if (headers.indexOf(SUBMISSION_ID_HEADER) !== headers.lastIndexOf(SUBMISSION_ID_HEADER)) {
    throw saveError('SCHEMA_MISMATCH', '集計シートの送信ID列を確認する必要があります。');
  }
}

// Prevent Sheets from interpreting user-supplied text as a formula.
function sheetText(value) { return value.charAt(0) === '=' ? "'" + value : value; }
function sameSheetText(stored, value) { return stored === value || stored === sheetText(value); }

function findDuplicate(ss, submission) {
  if (!submission.submissionId) return false;
  var found = false;
  ['クイック診断', '精密診断'].forEach(function(sheetName) {
    var sheet = ss.getSheetByName(sheetName);
    var headers = sheetHeaders(sheet);
    var idIndex = headers.indexOf(SUBMISSION_ID_HEADER);
    if (idIndex < 0 || sheet.getLastRow() < 2) return;
    if (idIndex !== headers.lastIndexOf(SUBMISSION_ID_HEADER)) {
      throw saveError('SCHEMA_MISMATCH', '集計シートの送信ID列を確認する必要があります。');
    }
    var ids = sheet.getRange(2, idIndex + 1, sheet.getLastRow() - 1, 1).getValues();
    ids.forEach(function(idRow, index) {
      if (idRow[0] !== submission.submissionId) return;
      var row = sheet.getRange(index + 2, 1, 1, headers.length).getValues()[0];
      if (row[headers.indexOf('モード')] !== submission.mode) {
        throw saveError('ID_CONFLICT', '送信内容が前回と異なります。入力内容を前回の状態に戻すか、診断をやり直してください。');
      }
      assertHeaders(headers, DIAGNOSIS_FIELDS[submission.mode]);
      var matches = row[headers.indexOf('モード')] === submission.mode &&
        sameSheetText(row[headers.indexOf('氏名')], submission.name) &&
        sameSheetText(row[headers.indexOf('メール')], submission.email) &&
        DIAGNOSIS_FIELDS[submission.mode].every(function(field) {
          return row[headers.indexOf(field)] === submission.ratings[field];
        });
      if (!matches) throw saveError('ID_CONFLICT', '送信内容が前回と異なります。入力内容を前回の状態に戻すか、診断をやり直してください。');
      found = true;
    });
  });
  return found;
}

function ensureSheetSize(sheet, rows, columns) {
  if (sheet.getMaxColumns() < columns) sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
  if (sheet.getMaxRows() < rows) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
}

function saveToSheet(submission) {
  var sheetId = getSheetId();
  if (!sheetId) throw saveError('CONFIG_ERROR', '保存先が設定されていません。管理者へお問い合わせください。');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw saveError('BUSY', 'ただいま混み合っています。同じ画面からもう一度お試しください。');
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    if (findDuplicate(ss, submission)) return { duplicate: true };
    var fields = DIAGNOSIS_FIELDS[submission.mode];
    var sheetName = submission.mode === 'quick' ? 'クイック診断' : '精密診断';
    var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
    var headers = sheetHeaders(sheet);
    if (!headers.length) {
      headers = ['日時', '氏名', 'メール', 'モード'].concat(fields).concat(['平均', SUBMISSION_ID_HEADER]);
      ensureSheetSize(sheet, 1, headers.length);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      assertHeaders(headers, fields);
      if (headers.indexOf(SUBMISSION_ID_HEADER) < 0) {
        headers.push(SUBMISSION_ID_HEADER);
        ensureSheetSize(sheet, 1, headers.length);
        sheet.getRange(1, headers.length).setValue(SUBMISSION_ID_HEADER);
      }
    }
    var rowNumber = sheet.getLastRow() + 1;
    var scoreCells = fields.map(function(field) { return columnToLetter(headers.indexOf(field) + 1) + rowNumber; });
    var values = headers.map(function(header) {
      if (header === '日時') return new Date();
      if (header === '氏名') return sheetText(submission.name);
      if (header === 'メール') return sheetText(submission.email);
      if (header === 'モード') return submission.mode;
      if (header === '平均') return '=AVERAGE(' + scoreCells.join(',') + ')';
      if (header === SUBMISSION_ID_HEADER) return submission.submissionId;
      return fields.indexOf(header) >= 0 ? submission.ratings[header] : '';
    });
    // Scores, average formula and retry ID are written together, under one lock.
    ensureSheetSize(sheet, rowNumber, headers.length);
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
    SpreadsheetApp.flush();
    return { duplicate: false };
  } finally {
    lock.releaseLock();
  }
}

// 列番号（1始まり）をアルファベット表記に変換
function columnToLetter(col) {
  var letter = '';
  while (col > 0) {
    var rem = (col - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

// =========================================================
// 登録通知メール（名前・メール登録時に管理者へ送信）
// =========================================================
function sendRegistrationNotification(name, email, mode) {
  try {
    var notifyEmail = getNotifyEmail();
    if (!notifyEmail) return 'not_configured';
    var modeLabel = mode === 'quick' ? 'クイック診断（8問）' : '精密診断（24問）';
    var subject = '【新規診断登録】' + name + ' 様';
    var body =
      '新しい診断の登録がありました。\n\n' +
      '【氏名】' + name + '\n' +
      '【メール】' + email + '\n' +
      '【診断モード】' + modeLabel + '\n' +
      '【日時】' + new Date().toLocaleString('ja-JP') + '\n\n' +
      'スプレッドシートで詳細を確認してください。';

    GmailApp.sendEmail(notifyEmail, subject, body);
    return 'sent';
  } catch (err) {
    console.error('登録通知メール送信エラー');
    return 'failed';
  }
}
