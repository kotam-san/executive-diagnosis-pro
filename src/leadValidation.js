export function leadErrors({ name = '', email = '' }) {
  const errors = {}
  const trimmedName = name.trim(), trimmedEmail = email.trim()
  if (!trimmedName || trimmedName.length > 200 || /[\u0000-\u001f\u007f]/.test(trimmedName)) errors.name = 'お名前は200文字以内で、改行を入れずに入力してください。'
  if (trimmedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) errors.email = '有効なメールアドレスを254文字以内で入力してください。'
  return errors
}
