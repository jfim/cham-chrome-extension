import { describe, it, expect } from 'vitest';
import { classifyDocument } from './readability-classifier';

function makeArticleDoc(): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head><title>Test Article</title></head>
     <body>
       <article>
         <h1>A Lengthy Article About Goldfish</h1>
         ${Array.from(
           { length: 30 },
           () =>
             '<p>Goldfish are remarkable creatures, and their memory is far better than commonly assumed. Researchers have documented complex behaviors that suggest substantial cognitive ability.</p>',
         ).join('')}
       </article>
     </body></html>`,
    'text/html',
  );
}

function makeInboxDoc(): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>
       <ul>
         <li>From: alice — subject A</li>
         <li>From: bob — subject B</li>
       </ul>
     </body></html>`,
    'text/html',
  );
}

describe('classifyDocument', () => {
  it('returns isArticle=true for an article-like document', () => {
    const result = classifyDocument(makeArticleDoc());
    expect(result.isArticle).toBe(true);
  });

  it('returns isArticle=false for a short list-of-links document', () => {
    const result = classifyDocument(makeInboxDoc());
    expect(result.isArticle).toBe(false);
  });
});
