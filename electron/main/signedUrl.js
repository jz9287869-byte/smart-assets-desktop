const crypto = require('crypto');

function hmacSha256Hex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function normalizePath(p) {
  return String(p || '').replace(/\//g, '\\');
}

function signLocalAssetUrl({ scheme = 'smart-image', filePath, expiresAtMs, secret }) {
  const pathValue = normalizePath(filePath);
  const exp = Number(expiresAtMs);
  if (!pathValue) throw new Error('filePath is required');
  if (!Number.isFinite(exp) || exp <= Date.now()) throw new Error('expiresAtMs is invalid');
  if (!secret) throw new Error('secret is required');

  const payload = `${pathValue}\n${exp}`;
  const sig = hmacSha256Hex(secret, payload);
  const url = `${scheme}://asset?path=${encodeURIComponent(pathValue)}&exp=${exp}&sig=${sig}`;
  return { url, exp, sig };
}

function verifyLocalAssetUrl({ filePath, exp, sig, secret }) {
  const pathValue = normalizePath(filePath);
  const expNum = Number(exp);
  if (!pathValue) return { ok: false, reason: 'missing_path' };
  if (!Number.isFinite(expNum)) return { ok: false, reason: 'bad_exp' };
  if (!sig) return { ok: false, reason: 'missing_sig' };
  if (expNum <= Date.now()) return { ok: false, reason: 'expired' };
  const expected = hmacSha256Hex(secret, `${pathValue}\n${expNum}`);
  const ok = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(sig), 'hex'));
  return ok ? { ok: true } : { ok: false, reason: 'bad_sig' };
}

module.exports = { signLocalAssetUrl, verifyLocalAssetUrl };

