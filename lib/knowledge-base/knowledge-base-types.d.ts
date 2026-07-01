declare module 'unpdf' {
  export function extractText(data: Uint8Array, options?: { mergePages?: boolean }): Promise<{ text: string | string[] }>;
}

declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string, options?: { url?: string });
    window: {
      document: Document;
    };
  }
}

declare module '@mozilla/readability' {
  export class Readability {
    constructor(doc: Document);
    parse(): { textContent?: string } | null;
  }
}
