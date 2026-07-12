// Jest runs Babel-transformed code as CommonJS, which has no equivalent for
// `import.meta` (used by src/shared/config.js for Vite env vars). Preset-env
// leaves `import.meta` untouched since there's no CJS form, so without this
// plugin any test that transitively imports config.js fails at runtime with
// "Cannot use 'import.meta' outside a module". Rewriting `import.meta` to
// `({ env: process.env })` gives `import.meta.env.X` a working CJS-safe
// value (undefined in Jest, falling back to the hardcoded defaults in
// config.js — which is the same behavior as running unpackaged in a plain
// browser without Vite's env injection).
function transformImportMetaForJest() {
  return {
    visitor: {
      MetaProperty(path) {
        if (path.node.meta.name === 'import' && path.node.property.name === 'meta') {
          path.replaceWithSourceString('({ env: process.env })');
        }
      }
    }
  };
}

module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }]
  ],
  plugins: [transformImportMetaForJest]
};
