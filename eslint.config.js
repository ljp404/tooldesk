import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import vue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'dist/**',
      'android/app/src/main/assets/public/**',
      'local-tools/**',
      'node_modules/**',
      'plugins/**/assets/*.bundle.js',
      'plugins/**/tools/**',
      'plugins/**/vendor/**',
      'public/**/*.js',
      'release/**',
      'runtime/**',
      'src-tauri/target/**'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        Blob: 'readonly',
        ClipboardEvent: 'readonly',
        DragEvent: 'readonly',
        document: 'readonly',
        Event: 'readonly',
        File: 'readonly',
        FileReader: 'readonly',
        HTMLElement: 'readonly',
        HTMLImageElement: 'readonly',
        HTMLInputElement: 'readonly',
        HTMLTextAreaElement: 'readonly',
        KeyboardEvent: 'readonly',
        localStorage: 'readonly',
        MouseEvent: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        structuredClone: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        window: 'readonly',
        TooldeskLocalLibraryConfig: 'readonly',
        TooldeskLocalLibrarySearchResult: 'readonly',
        TooldeskKeePassSettings: 'readonly',
        TooldeskLocalLibrarySettings: 'readonly'
      },
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue']
      }
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['scripts/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    files: ['*.cjs'],
    languageOptions: {
      globals: {
        module: 'readonly'
      }
    }
  },
  {
    files: ['src/components/ui/JsonHighlightField.vue', 'src/tools/json-formatter/JsonFormatter.vue'],
    rules: {
      'vue/no-v-html': 'off'
    }
  },
  prettier
];
