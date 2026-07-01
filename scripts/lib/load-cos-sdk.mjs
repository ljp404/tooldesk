export async function loadCosSdk() {
  try {
    const module = await import('cos-nodejs-sdk-v5');
    return module.default;
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('缺少 COS 发布 SDK。仅发布到腾讯云 COS 时需要安装：npm.cmd install --no-save cos-nodejs-sdk-v5@^2.15.4', {
        cause: error
      });
    }

    throw error;
  }
}
