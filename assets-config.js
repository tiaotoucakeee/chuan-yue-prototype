/**
 * 线上大资源 CDN 配置（协作时只改这一处）
 * 本地开发：留空，使用相对路径 + 本地 museum/、assets/videos/
 * 线上部署：填 OSS/CDN 根地址，例如 https://your-bucket.oss-cn-hangzhou.aliyuncs.com/chuan-yue
 */
window.CHuanYueConfig = {
  cdnBase: '',

  resolve: function (relativePath) {
    var path = String(relativePath || '').replace(/^\//, '');
    if (!this.cdnBase) return './' + path;
    return this.cdnBase.replace(/\/$/, '') + '/' + path;
  },

  museumUrl: function () {
    return this.resolve('museum/index.html');
  }
};
