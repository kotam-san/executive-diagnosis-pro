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

    if      (action === 'save_only')       result = handleSaveOnly(payload);
    else if (action === 'get_advice')      result = handleGetAdvice(payload);
    else if (action === 'generate_plan')   result = handleGeneratePlan(payload);
    else result = { status: 'error', message: '不明なアクション: ' + action };

    output.setContent(JSON.stringify(result));
  } catch (err) {
    output.setContent(JSON.stringify({ status: 'error', message: 'サーバーエラー: ' + err.message }));
  }

  return output;
}

// =========================================================
// save_only: スプレッドシート保存 + 登録通知メール送信
// =========================================================
function handleSaveOnly(payload) {
  var name    = payload.name    || '';
  var email   = payload.email   || '';
  var ratings = payload.ratings || {};
  var mode    = payload.mode    || 'full';

  // スプレッドシートに保存
  saveToSheet(name, email, ratings, mode);

  // 管理者に登録通知メールを送信
  sendRegistrationNotification(name, email, mode);

  return { status: 'success' };
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
function saveToSheet(name, email, ratings, mode) {
  var sheetId = getSheetId();
  if (!sheetId) return;

  try {
    var ss = SpreadsheetApp.openById(sheetId);

    // モードに応じてシート名を決定
    var sheetName = (mode === 'quick') ? 'クイック診断' : '精密診断';
    var sheet = ss.getSheetByName(sheetName);

    // シートが存在しない場合は作成
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }

    // ヘッダー行がなければ追加
    if (sheet.getLastRow() === 0) {
      var headers = ['日時', '氏名', 'メール', 'モード'].concat(Object.keys(ratings)).concat(['平均']);
      sheet.appendRow(headers);
    }

    // データ行を追加
    var scoreValues = Object.values(ratings);
    var dataRow = [new Date(), name, email, mode].concat(scoreValues).concat(['']);
    sheet.appendRow(dataRow);

    // 追加した行にAVERAGE数式を設定（E列から最後のスコア列まで）
    var currentRow = sheet.getLastRow();
    var scoreStartCol = 5; // E列
    var scoreEndCol   = 4 + scoreValues.length;
    var avgCol        = scoreEndCol + 1;
    var startLetter   = columnToLetter(scoreStartCol);
    var endLetter     = columnToLetter(scoreEndCol);
    sheet.getRange(currentRow, avgCol).setFormula(
      '=AVERAGE(' + startLetter + currentRow + ':' + endLetter + currentRow + ')'
    );

  } catch (err) {
    console.error('スプレッドシート保存エラー: ' + err.message);
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
  var notifyEmail = getNotifyEmail();
  if (!notifyEmail) return;

  try {
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
  } catch (err) {
    console.error('登録通知メール送信エラー: ' + err.message);
  }
}

// =========================================================
// デバッグ用（確認後に削除してOK）
// =========================================================
function debugAll() {
  var apiKey      = getApiKey();
  var sheetId     = getSheetId();
  var notifyEmail = getNotifyEmail();

  console.log('=== スクリプトプロパティ ===');
  console.log('CLAUDE_API_KEY: ' + (apiKey ? '設定済み（' + apiKey.substring(0,10) + '...）' : '未設定！'));
  console.log('SHEET_ID: '       + (sheetId     || '未設定'));
  console.log('NOTIFY_EMAIL: '   + (notifyEmail  || '未設定'));

  console.log('\n=== Claude APIテスト ===');
  var result = generateAnalysis('テスト', {'ビジネス・仕事': 3, 'お金・収入': 2}, 'quick');
  console.log('Claude結果: ' + result.substring(0, 150));

  console.log('\n=== 登録通知メールテスト ===');
  if (notifyEmail) {
    GmailApp.sendEmail(notifyEmail, '【テスト】GAS登録通知', 'テスト太郎 / test@example.com の登録通知テストです。');
    console.log(notifyEmail + ' に送信完了');
  }
}
