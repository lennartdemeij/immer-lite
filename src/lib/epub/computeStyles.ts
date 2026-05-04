import type { BookComputedStyle } from '../../types/book';

export const COMPUTED_STYLE_ATTRIBUTE = 'data-pretext-computed-style';
let sharedFrame: HTMLIFrameElement | null = null;

export interface StyleMeasurementInput {
  doc: Document;
  styleTexts: string[];
}

const RELEVANT_STYLE_TAGS = new Set([
  'a',
  'article',
  'b',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
  'ul'
]);

function toPxNumber(value: string): number {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function resolvePageBreak(style: CSSStyleDeclaration): BookComputedStyle['cssDefinedPageBreak'] {
  const breakBefore = String(style.breakBefore || style.pageBreakBefore || '').toLowerCase();
  if (breakBefore === 'page' || breakBefore === 'always') {
    return 'before';
  }

  const breakAfter = String(style.breakAfter || style.pageBreakAfter || '').toLowerCase();
  if (breakAfter === 'page' || breakAfter === 'always') {
    return 'after';
  }

  return undefined;
}

export function serializeComputedStyle(style: CSSStyleDeclaration): BookComputedStyle {
  return {
    marginTop: toPxNumber(style.marginTop),
    marginBottom: toPxNumber(style.marginBottom),
    marginLeft: toPxNumber(style.marginLeft),
    marginRight: toPxNumber(style.marginRight),
    paddingTop: toPxNumber(style.paddingTop),
    paddingBottom: toPxNumber(style.paddingBottom),
    paddingLeft: toPxNumber(style.paddingLeft),
    paddingRight: toPxNumber(style.paddingRight),
    fontFamily: style.fontFamily,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    fontVariant: style.fontVariant,
    textDecorationLine: style.textDecorationLine,
    textAlign: style.textAlign,
    display: style.display,
    cssDefinedPageBreak: resolvePageBreak(style)
  };
}

export function readComputedStyleSnapshot(element: Element): BookComputedStyle | undefined {
  const raw = element.getAttribute(COMPUTED_STYLE_ATTRIBUTE);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as BookComputedStyle;
  } catch {
    return undefined;
  }
}

function waitForStyles(frameWindow: Window): Promise<void> {
  return new Promise((resolve) => {
    if (typeof frameWindow.requestAnimationFrame === 'function') {
      frameWindow.requestAnimationFrame(() => {
        frameWindow.requestAnimationFrame(() => resolve());
      });
      return;
    }
    setTimeout(resolve, 0);
  });
}

function stripResourceAttributes(root: ParentNode): void {
  root
    .querySelectorAll(
      'img, source, video, audio, iframe, object, embed, track, input[type="image"]'
    )
    .forEach((element) => {
      element.removeAttribute('src');
      element.removeAttribute('srcset');
      element.removeAttribute('poster');
      element.removeAttribute('data');
    });
}

function ensureSharedFrame(): HTMLIFrameElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  if (sharedFrame && sharedFrame.isConnected) {
    return sharedFrame;
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('sandbox', 'allow-same-origin');
  iframe.tabIndex = -1;
  iframe.style.position = 'absolute';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.left = '-99999px';
  iframe.style.top = '0';
  document.body.appendChild(iframe);
  sharedFrame = iframe;
  return iframe;
}

function hasDirectReadableText(element: Element): boolean {
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
  );
}

function isStyleRelevantElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  return (
    RELEVANT_STYLE_TAGS.has(tag) ||
    hasDirectReadableText(element) ||
    element.hasAttribute('class') ||
    element.hasAttribute('style') ||
    element.hasAttribute('id') ||
    element.hasAttribute('href')
  );
}

function getRelevantElements(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('*')).filter(isStyleRelevantElement);
}

export async function annotateDocumentsWithComputedStyles(
  inputs: StyleMeasurementInput[]
): Promise<boolean[]> {
  const iframe = ensureSharedFrame();
  if (!iframe) {
    return inputs.map(() => false);
  }

  const frameDoc = iframe.contentDocument;
  const frameWindow = iframe.contentWindow;
  if (!frameDoc || !frameWindow) {
    return inputs.map(() => false);
  }

  if (!frameDoc.documentElement) {
    frameDoc.open();
    frameDoc.write('<!doctype html><html><head></head><body></body></html>');
    frameDoc.close();
  }

  frameDoc.documentElement.lang = inputs[0]?.doc.documentElement.lang || '';
  frameDoc.head.replaceChildren();
  frameDoc.body.replaceChildren();

  const measurementData = inputs.map(({ doc, styleTexts }, index) => {
    const body = doc.querySelector('body');
    if (!body) {
      return {
        sourceElements: [] as Element[],
        renderedElements: [] as Element[]
      };
    }

    const host = frameDoc.createElement('div');
    host.setAttribute('data-style-measurement-host', `${index}`);
    frameDoc.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    styleTexts.forEach((styleText) => {
      const styleElement = frameDoc.createElement('style');
      styleElement.textContent = styleText;
      shadowRoot.appendChild(styleElement);
    });

    const wrapper = frameDoc.createElement('div');
    const preparedBody = body.cloneNode(true) as HTMLElement;
    stripResourceAttributes(preparedBody);
    wrapper.innerHTML = preparedBody.innerHTML;
    shadowRoot.appendChild(wrapper);

    return {
      sourceElements: getRelevantElements(body),
      renderedElements: getRelevantElements(wrapper)
    };
  });

  await waitForStyles(frameWindow);

  const results = measurementData.map(({ sourceElements, renderedElements }) => {
    const sharedLength = Math.min(sourceElements.length, renderedElements.length);
    for (let index = 0; index < sharedLength; index += 1) {
      sourceElements[index].setAttribute(
        COMPUTED_STYLE_ATTRIBUTE,
        JSON.stringify(
          serializeComputedStyle(frameWindow.getComputedStyle(renderedElements[index]))
        )
      );
    }

    return sharedLength > 0;
  });

  frameDoc.body.replaceChildren();
  frameDoc.head.replaceChildren();

  return results;
}

export async function annotateDocumentWithComputedStyles(
  doc: Document,
  styleTexts: string[]
): Promise<boolean> {
  const [result] = await annotateDocumentsWithComputedStyles([{ doc, styleTexts }]);
  return result ?? false;
}
