import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['node_modules/**', 'coverage/**', 'fixtures/**', '.tmp/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // A parameter a function keeps for the shape
      // of its signature rather than for its value
      // says so with a leading underscore, the way
      // an unread express request already does.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  prettier, // last — turns off rules that fight Prettier
);
