const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('static/testcases.js', 'utf8');
const start = source.indexOf('function normalizeOutput');
const end = source.indexOf('function renderTestRunOutput');
assert(start >= 0 && end > start, 'testcase value helpers were not found');
const context = {};
vm.runInNewContext(source.slice(start, end), context);

function equal(actualText, expectedText, declaredType = '') {
  const actual = context.extractHarnessReturn(`Office Hours Prep result 1: ${actualText}`, declaredType);
  const expected = context.parseExpectedReturn(expectedText, actual, declaredType);
  assert(actual !== null && expected !== null);
  assert(context.typedValuesEqual(actual, expected), `${actualText} should equal ${expectedText}`);
}

equal("'hello'", 'hello');
equal("''", '""');
equal("'(a) + (b)'", "'(a) + (b)'");
equal("('hello')", "'hello'");
equal('4', '4');
equal('4.0', '4');
equal('True', 'true');
equal('[1, 2, 3]', '[1, 2, 3]');
equal('[1, 2]', '[1, 2]', 'int[]');
equal('123', '"123"', 'String');

const differentString = context.extractHarnessReturn("Office Hours Prep result 1: '(a)'");
const expectedDifferentString = context.parseExpectedReturn("'(b)'", differentString, '');
assert(!context.typedValuesEqual(differentString, expectedDifferentString));

console.log('testcase value comparisons passed');
