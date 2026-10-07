// Shared by the Lambda tests' drift checks: the copy of a function's code
// inlined in the CloudFormation template, and a source file as it should
// appear there.

const fs = require('node:fs');
const path = require('node:path');

const TEMPLATE = path.join(__dirname, '..', '..', 'infra', 'luna-feeder.yaml');

// The ZipFile block of the function with this FunctionName, de-indented.
exports.inlineCode = (functionName) => {
  const lines = fs.readFileSync(TEMPLATE, 'utf8').split('\n');
  const fn = lines.findIndex((l) => l.includes(`FunctionName: ${functionName}`));
  if (fn < 0) throw new Error(`${functionName} not found in template`);
  const zip = lines.findIndex((l, i) => i > fn && l.trim() === 'ZipFile: |');
  const indent = ' '.repeat(lines[zip].indexOf('ZipFile') + 2);
  const inline = [];
  for (const l of lines.slice(zip + 1)) {
    if (l.trim() === '') { inline.push(''); continue; }
    if (!l.startsWith(indent)) break;
    inline.push(l.slice(indent.length));
  }
  return inline.join('\n').trimEnd();
};

// The source file without the header lines only the source carries.
exports.sourceAsInlined = (file) => fs.readFileSync(file, 'utf8').replace(
  /^\/\/\n\/\/ Deployed inline via[^\n]*\n\/\/ This file is the source of truth[^\n]*\n/m, '').trimEnd();
