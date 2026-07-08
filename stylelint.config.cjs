/** @type {import('stylelint').Config} */
module.exports = {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['dist/**/*.css', 'release/**/*.css'],
  rules: {
    'alpha-value-notation': null,
    'color-function-alias-notation': null,
    'color-function-notation': null,
    'color-hex-length': null,
    'declaration-empty-line-before': null,
    'import-notation': null,
    'no-descending-specificity': null,
    'value-keyword-case': null
  }
};
