export function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

export function joinPath(base: string, relative: string): string {
  if (!relative) {
    return base;
  }

  if (/^[a-z]+:/i.test(relative)) {
    return relative;
  }

  const stack = base.split('/').filter(Boolean);
  for (const part of relative.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  return stack.join('/');
}

export function stripFragment(href: string): string {
  const hashIndex = href.indexOf('#');
  return hashIndex === -1 ? href : href.slice(0, hashIndex);
}
