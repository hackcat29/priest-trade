# Priest.trade Documentation

This directory contains the complete Mintlify documentation suite for **[Priest.trade](https://priest.trade)** — the Monad-native perpetuals launchpad and exchange.

## 🚀 Running Locally with Mintlify

To preview the documentation locally:

```bash
# Install the Mintlify CLI
npm i -g mintlify

# Start the local development preview
cd docs
mintlify dev
```

The documentation server will launch at `http://localhost:3000`.

## 📐 Documentation Structure
- `docs.json`: Modern Mintlify schema configuration with tabs, groups, and brand colors.
- `mint.json`: Backward-compatible Mintlify configuration file.
- `*.mdx`: All documentation pages with metadata frontmatter, KaTeX math formulas, and interactive Mintlify callout components.
