import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tailwindcss from 'eslint-plugin-tailwindcss';
import unusedImports from 'eslint-plugin-unused-imports';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';

const typeConfig = {
  name: 'Type Config',
  files: ['src/**/*.{ts,tsx}'],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    'no-var': 'error',
    'sort-imports': 0,
    '@typescript-eslint/explicit-module-boundary-types': 'warn',
    '@typescript-eslint/no-misused-promises': 'warn',
    '@typescript-eslint/strict-boolean-expressions': 'error',
    '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
    '@typescript-eslint/consistent-type-imports': [
      'warn',
      {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
      },
    ],
  },
};

const importConfig = {
  name: 'Import Config',
  files: ['src/**/*.{js,ts,jsx,tsx}'],
  plugins: {
    'simple-import-sort': simpleImportSort,
    'unused-imports': unusedImports,
  },
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': 'off',

    'simple-import-sort/imports': [
      'error',
      {
        groups: [
          ['^react', '^react-dom'],
          ['^node:', '^@?\\w'],
          ['^@/'],
          ['^\\.'],
          ['^.+\\.(css|scss|sass|less)$'],
        ],
      },
    ],
    'simple-import-sort/exports': 'error',
    'import/first': 'error',
    'import/newline-after-import': 'error',
    'import/no-duplicates': 'error',
    'unused-imports/no-unused-imports': 'error',
    'unused-imports/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      },
    ],
  },
};

const tailwindConfig = {
  name: 'Tailwind Config',
  files: ['src/**/*.{js,ts,jsx,tsx}'],
  rules: {
    'tailwindcss/classnames-order': 'warn',
    'tailwindcss/no-custom-classname': 'warn',
    'tailwindcss/no-contradicting-classname': 'error',
  },
};

const stylisticConfig = {
  name: 'Stylistic Config',
  files: ['src/**/*.{js,ts,jsx,tsx}'],
  plugins: { '@stylistic': stylistic },
  rules: {
    '@stylistic/padding-line-between-statements': [
      'error',
      { blankLine: 'always', prev: '*', next: 'return' },
      { blankLine: 'always', prev: '*', next: ['function', 'class'] },
      { blankLine: 'always', prev: '*', next: ['if', 'switch'] },
      { blankLine: 'always', prev: 'directive', next: '*' },
      { blankLine: 'never', prev: 'directive', next: 'directive' },
    ],
  },
};

export default defineConfig([
  {
    ignores: [
      '**/node_modules/',
      '**/.next/',
      '**/next-env.d.ts',
      '**/*.config.mjs',
      '**/*.config.js',
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },

  // Next.js flat config: react / react-hooks / @next/next / import / jsx-a11y をネイティブ配線
  nextCoreWebVitals,
  // typescript-eslint recommended（非 type-checked）＋ Next 独自 tweak・ignores
  nextTs,
  tseslint.configs.recommendedTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  tailwindcss.configs['flat/recommended'],
  typeConfig,
  importConfig,
  tailwindConfig,
  stylisticConfig,

  // src/app/ に JS ファイルを置く場合は以下を有効化する。
  // 型チェック系ルールが tsconfig 外の JS ファイルに適用されてエラーになるのを防ぐ。
  // {
  //   files: ['**/*.{js,mjs,cjs}'],
  //   ...tseslint.configs.disableTypeChecked,
  // },

  // 整形ルールの競合を解消（必ず最後に置く）
  prettier,
]);
