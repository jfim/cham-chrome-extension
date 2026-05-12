import { Readability, isProbablyReaderable } from '@mozilla/readability';

export interface ClassificationResult {
  isArticle: boolean;
  title?: string;
  excerpt?: string;
}

export function classifyDocument(doc: Document): ClassificationResult {
  if (!isProbablyReaderable(doc)) return { isArticle: false };

  const cloned = doc.cloneNode(true) as Document;
  const parsed = new Readability(cloned).parse();
  if (!parsed || !parsed.textContent || parsed.textContent.trim().length < 500) {
    return { isArticle: false };
  }
  return {
    isArticle: true,
    title: parsed.title ?? undefined,
    excerpt: parsed.excerpt ?? undefined,
  };
}
