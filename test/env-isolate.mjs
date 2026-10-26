// 测试必须是「与开发机无关」的。
//
// 本机可能把更新源指向镜像（HKCU 里设 PURGE_UPDATE_REPO /
// PURGE_UPDATE_PROVIDER / PURGE_GH_MIRROR），`npm test` 会原样继承。
// 这样 update-source / update-download / update-http / update-integrity /
// update-proxy-runtime 里断言「默认发行源」的用例会全部失败——它们测的是
// 默认值，不是本机偏好。
//
// 需要特定环境的用例自己显式设置 process.env 即可；这里只清掉继承来的
// Purge 偏好，别的一概不动（代理、证书、PATH 都保留）。
const INHERITED_PURGE_SETTINGS = [
  "PURGE_UPDATE_REPO",
  "PURGE_UPDATE_PROVIDER",
  "PURGE_GH_MIRROR",
];

for (const key of INHERITED_PURGE_SETTINGS) delete process.env[key];
