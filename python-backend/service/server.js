const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.SMART_IMAGE_LIBRARY_DATA_DIR =
  process.env.SMART_IMAGE_LIBRARY_DATA_DIR || process.env.DATA_DIR || path.join(process.cwd(), '.data');

const ImageDatabase = require('../../src/main/database');
const { signLocalAssetUrl } = require('../../src/main/signedUrl');
const { statFsForPath, checkQuota } = require('../../src/main/diskQuota');

function nowMs() {
  return Date.now();
}

function sendJson(res, statusCode, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(buf.length)
  });
  res.end(buf);
}

function ok(data) {
  return { code: 0, msg: 'ok', data, timestamp: nowMs() };
}

function fail(code, msg, data = null) {
  return { code, msg, data, timestamp: nowMs() };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve(null);
      const raw = Buffer.concat(chunks).toString('utf-8');
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function fingerprintRequest(req, urlObj, body) {
  const canonical = JSON.stringify({
    method: req.method,
    path: urlObj.pathname,
    query: Object.fromEntries(urlObj.searchParams.entries()),
    body: body || null
  });
  return sha256Hex(canonical);
}

async function withIdempotency(db, req, fingerprint, handler) {
  const key = req.headers['idempotency-key'] ? String(req.headers['idempotency-key']) : null;
  if (!key) return handler();
  const row = db.getIdempotency(key);
  if (row && row.request_fingerprint === fingerprint && row.response_json) {
    try {
      return JSON.parse(row.response_json);
    } catch (_) {}
  }
  const resp = await handler();
  try {
    db.setIdempotency(key, fingerprint, JSON.stringify(resp), null);
  } catch (_) {}
  return resp;
}

async function main() {
  const db = new ImageDatabase();
  await db.initialize();

  const trashFolder = process.env.TRASH_FOLDER || 'D:\\素材回收缓冲站';
  const signedUrlSecret = process.env.SIGNED_URL_SECRET || 'dev-secret-change-me';
  const signedUrlTtlSec = Number(process.env.SIGNED_URL_TTL_SEC || 120) || 120;
  const diskQuotaBytes = process.env.DISK_QUOTA_BYTES ? Number(process.env.DISK_QUOTA_BYTES) : null;
  const diskMinFreeBytes = process.env.DISK_MIN_FREE_BYTES ? Number(process.env.DISK_MIN_FREE_BYTES) : null;

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    const method = req.method || 'GET';

    try {
      if (method === 'GET' && urlObj.pathname === '/health') {
        return sendJson(res, 200, ok({ status: 'ok' }));
      }

      if (method === 'GET' && urlObj.pathname === '/api/v1/images/search') {
        const q = Object.fromEntries(urlObj.searchParams.entries());
        const query = {
          keyword: q.keyword || '',
          folder_path: q.folder_path || null,
          is_deleted: q.is_deleted !== undefined ? Number(q.is_deleted) : 0,
          delete_batch: q.delete_batch || null,
          tags: q.tag ? [q.tag] : null,
          page: q.page ? Number(q.page) : undefined,
          page_size: q.page_size ? Number(q.page_size) : undefined,
          sort_by: q.sort_by || undefined,
          sort_order: q.sort_order || undefined,
          return_meta: q.return_meta ? Boolean(Number(q.return_meta)) : false
        };
        const data = db.searchImages(query, null);
        return sendJson(res, 200, ok(data));
      }

      if (method === 'POST' && urlObj.pathname === '/api/v1/trash/move') {
        const body = await readBody(req);
        const fp = fingerprintRequest(req, urlObj, body);
        const resp = await withIdempotency(db, req, fp, async () => {
          const ids = Array.isArray(body?.image_ids) ? body.image_ids : [];
          if (ids.length === 0) return fail(400, 'bad_request', { error: 'image_ids required' });
          const date = new Date();
          const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
            date.getDate()
          ).padStart(2, '0')}`;
          const existing = db.getTrashBatches();
          const todayBatches = existing.filter(b => b.batch_name && b.batch_name.startsWith(dateStr));
          const batchNumber = todayBatches.length + 1;
          const batchName = `${dateStr}第${batchNumber}批删除图片`;
          const targetDir = path.join(trashFolder, batchName);
          const quota = await checkQuota({
            targetPath: targetDir,
            bytesToWrite: 0,
            quotaBytes: diskQuotaBytes,
            minFreeBytes: diskMinFreeBytes
          });
          if (!quota.ok) return fail(quota.code, quota.msg, quota);
          await fs.promises.mkdir(targetDir, { recursive: true });
          for (const imageId of ids) {
            const image = db.getImageById(imageId);
            if (!image) continue;
            const sourcePath = image.path;
            const targetPath = path.join(targetDir, image.filename);
            await fs.promises.rename(sourcePath, targetPath);
            db.markAsDeleted(imageId, targetPath, batchName);
          }
          return ok({ batch_name: batchName });
        });
        return sendJson(res, 200, resp);
      }

      if (method === 'POST' && urlObj.pathname === '/api/v1/trash/restore') {
        const body = await readBody(req);
        const fp = fingerprintRequest(req, urlObj, body);
        const resp = await withIdempotency(db, req, fp, async () => {
          const batchId = body?.batch_id;
          if (!batchId) return fail(400, 'bad_request', { error: 'batch_id required' });
          const images = db.getImagesByBatch(batchId);
          for (const image of images) {
            if (!image.trash_path) continue;
            await fs.promises.rename(image.trash_path, image.path);
            db.markAsRestored(image.id);
          }
          return ok(null);
        });
        return sendJson(res, 200, resp);
      }

      if (method === 'POST' && urlObj.pathname === '/api/v1/images/delete') {
        const body = await readBody(req);
        const fp = fingerprintRequest(req, urlObj, body);
        const resp = await withIdempotency(db, req, fp, async () => {
          const ids = Array.isArray(body?.image_ids) ? body.image_ids : [];
          if (ids.length === 0) return fail(400, 'bad_request', { error: 'image_ids required' });
          for (const imageId of ids) {
            const image = db.getImageById(imageId);
            if (!image) continue;
            try {
              await fs.promises.unlink(image.path);
            } catch (_) {}
            if (image.thumbnail_path) {
              try {
                await fs.promises.unlink(image.thumbnail_path);
              } catch (_) {}
            }
            db.deleteImage(imageId);
          }
          return ok(null);
        });
        return sendJson(res, 200, resp);
      }

      if (method === 'GET' && urlObj.pathname === '/api/v1/jobs') {
        const q = Object.fromEntries(urlObj.searchParams.entries());
        const data = db.listJobs({
          status: q.status || null,
          type: q.type || null,
          limit: q.limit ? Number(q.limit) : 100,
          offset: q.offset ? Number(q.offset) : 0
        });
        return sendJson(res, 200, ok(data));
      }

      if (method === 'GET' && urlObj.pathname === '/api/v1/jobs/stats') {
        const type = urlObj.searchParams.get('type') || null;
        const data = db.getJobStats({ type });
        return sendJson(res, 200, ok(data));
      }

      if (method === 'POST' && urlObj.pathname === '/api/v1/jobs/retry') {
        const body = await readBody(req);
        const id = body?.id;
        if (!id) return sendJson(res, 200, fail(400, 'bad_request', { error: 'id required' }));
        const changes = db.retryJob(id);
        if (!changes) return sendJson(res, 200, fail(404, 'not_found', null));
        return sendJson(res, 200, ok({ retried: true }));
      }

      if (method === 'GET' && urlObj.pathname === '/api/v1/disk/status') {
        const p = urlObj.searchParams.get('path') || trashFolder;
        const stat = await statFsForPath(p);
        return sendJson(res, 200, ok({ ...stat, diskQuotaBytes, diskMinFreeBytes }));
      }

      if (method === 'GET' && urlObj.pathname === '/api/v1/assets/signed') {
        const imageId = urlObj.searchParams.get('image_id');
        const type = urlObj.searchParams.get('type') || 'file';
        const ttl = Math.max(
          5,
          Math.min(Number(urlObj.searchParams.get('ttl_sec') || signedUrlTtlSec) || signedUrlTtlSec, 3600)
        );
        let filePath = urlObj.searchParams.get('path');
        if (!filePath && imageId) {
          const img = db.getImageById(Number(imageId));
          if (!img) return sendJson(res, 200, fail(404, 'not_found', null));
          filePath = type === 'thumbnail' ? img.thumbnail_path || img.path : img.path;
        }
        if (!filePath) return sendJson(res, 200, fail(400, 'bad_request', { error: 'path or image_id required' }));
        if (!fs.existsSync(filePath)) return sendJson(res, 200, fail(404, 'not_found', null));
        const { url, exp } = signLocalAssetUrl({
          filePath,
          expiresAtMs: Date.now() + ttl * 1000,
          secret: signedUrlSecret
        });
        return sendJson(res, 200, ok({ url, exp }));
      }

      return sendJson(res, 404, fail(404, 'not_found', null));
    } catch (e) {
      return sendJson(res, 500, fail(500, 'internal_error', { error: e?.message || String(e) }));
    }
  });

  const port = Number(process.env.PORT || 8787) || 8787;
  const host = process.env.HOST || '0.0.0.0';
  server.listen(port, host, () => {
    process.stdout.write(`backend listening on http://${host}:${port}\n`);
  });
}

main().catch(err => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + '\n');
  process.exit(1);
});

