const path = require('path');
const fs = require('fs');

async function statFsForPath(anyPath) {
  const p = anyPath ? String(anyPath) : '';
  const root = path.parse(p).root || p;
  const target = root && fs.existsSync(root) ? root : path.dirname(p);
  const stat = await fs.promises.statfs(target);
  const totalBytes = Number(stat.bsize) * Number(stat.blocks);
  const freeBytes = Number(stat.bsize) * Number(stat.bavail);
  const usedBytes = totalBytes - freeBytes;
  return { totalBytes, freeBytes, usedBytes };
}

async function checkQuota({ targetPath, bytesToWrite = 0, quotaBytes = null, minFreeBytes = null }) {
  const { totalBytes, freeBytes, usedBytes } = await statFsForPath(targetPath);
  const nextFree = freeBytes - Math.max(0, Number(bytesToWrite) || 0);
  if (minFreeBytes !== null && minFreeBytes !== undefined) {
    if (nextFree < Number(minFreeBytes) || freeBytes < Number(minFreeBytes)) {
      return { ok: false, code: 507, msg: 'insufficient_storage', totalBytes, freeBytes, usedBytes };
    }
  }
  if (quotaBytes !== null && quotaBytes !== undefined) {
    const q = Number(quotaBytes);
    if (Number.isFinite(q) && q > 0) {
      const nextUsed = usedBytes + Math.max(0, Number(bytesToWrite) || 0);
      if (nextUsed > q) {
        return { ok: false, code: 507, msg: 'quota_exceeded', totalBytes, freeBytes, usedBytes };
      }
    }
  }
  return { ok: true, totalBytes, freeBytes, usedBytes };
}

module.exports = { statFsForPath, checkQuota };

