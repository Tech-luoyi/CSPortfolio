export function requireSessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('SESSION_SECRET 缺失或过短（至少 16 字符）：拒绝启动，避免使用可预测的签名密钥')
  }
  return secret
}
