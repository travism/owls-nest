// Astro page structure tests.
//
// Astro doesn't have a stable in-memory render API yet, so instead of
// rendering the .astro files we parse their source for the structural
// elements we care about: a Site layout wrapper with a `title` prop,
// an `<h1>` somewhere in the page body, and (per PRD §3.4) Open Graph
// metadata via the layout.
//
// Page rendering is also exercised by `astro build` in the build step
// — if any page fails to render, the build fails and so does CI.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGES_DIR = resolve(__dirname, '../pages');

const expectedPages: Array<{ file: string; title: RegExp; h1: RegExp }> = [
  { file: 'index.astro',          title: /Owl's Nest/,                  h1: /<h1>The Owl's Nest<\/h1>/ },
  { file: 'about.astro',          title: /title="About"/,                h1: /<h1>About<\/h1>/ },
  { file: 'gallery.astro',        title: /title="Gallery"/,              h1: /<h1>Gallery<\/h1>/ },
  { file: 'house-rules.astro',    title: /title="House rules/,           h1: /<h1>House rules/ },
  { file: 'book.astro',           title: /title="Book your stay"/,       h1: /<h1>Book your stay<\/h1>/ },
  { file: 'book/inquire.astro',   title: /title="Make a booking request"/, h1: /<h1>Make a booking request<\/h1>/ },
  { file: 'blog/index.astro',     title: /title="Blog"/,                  h1: /<h1>Blog<\/h1>/ },
  { file: 'area-guide/index.astro', title: /title="Area guide"/,          h1: /<h1>Area guide<\/h1>/ },
  { file: 'faq.astro',            title: /title="FAQ"/,                   h1: /<h1>FAQ<\/h1>/ },
];

describe('Astro pages — structural assertions', () => {
  for (const { file, title, h1 } of expectedPages) {
    describe(file, () => {
      const src = readFileSync(resolve(PAGES_DIR, file), 'utf-8');

      it('uses the Site layout', () => {
        expect(src).toMatch(/import Site from ['"][^'"]*layouts\/Site\.astro['"]/);
        expect(src).toMatch(/<Site[\s\S]+<\/Site>/);
      });

      it('passes a title to the Site layout', () => {
        expect(src).toMatch(title);
      });

      it('renders an <h1>', () => {
        expect(src).toMatch(h1);
      });
    });
  }
});

describe('Site layout', () => {
  const src = readFileSync(resolve(__dirname, '../layouts/Site.astro'), 'utf-8');

  it('emits a title tag', () => {
    expect(src).toMatch(/<title>\{siteTitle\}<\/title>/);
  });

  it('emits a meta description', () => {
    expect(src).toMatch(/<meta name="description"/);
  });

  it('emits Open Graph tags', () => {
    expect(src).toMatch(/property="og:title"/);
    expect(src).toMatch(/property="og:description"/);
    expect(src).toMatch(/property="og:type"/);
  });

  it('has a primary nav with all brand pages', () => {
    expect(src).toMatch(/href="\/about"/);
    expect(src).toMatch(/href="\/gallery"/);
    expect(src).toMatch(/href="\/house-rules"/);
    expect(src).toMatch(/href="\/book"/);
    expect(src).toMatch(/href="\/area-guide"/);
    expect(src).toMatch(/href="\/blog"/);
    expect(src).toMatch(/href="\/faq"/);
  });

  it('has a skip-link for keyboard users', () => {
    expect(src).toMatch(/class="skip-link"/);
  });
});
