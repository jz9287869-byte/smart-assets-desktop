/**
 * IPC 响应包装器
 * 统一 API 响应格式
 */

function ok(data) {
  return { success: true, ...data };
}

function fail(error, code = null) {
  return {
    success: false,
    error: typeof error === 'string' ? error : error?.message || '未知错误',
    code
  };
}

function wrap(fn) {
  return async (event, ...args) => {
    try {
      const result = await fn(event, ...args);
      return ok(result);
    } catch (error) {
      console.error('IPC 错误:', error);
      return fail(error);
    }
  };
}

module.exports = { ok, fail, wrap };
