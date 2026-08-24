const { assessRealMetaEnvironment } = require('./real-meta-environment.cjs');

const result = assessRealMetaEnvironment(process.env);
console.log(JSON.stringify(result, null, 2));
if (!result.readOnlyEnvironmentReady) process.exitCode = 1;
