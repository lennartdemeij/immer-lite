import type { CanonicalBook } from '../../types/book';
import { loadEpubBook, revokeBookResources } from '../epub/loadEpub';
import { isPdfFile, loadPdfBook } from '../pdf/loadPdf';

export function isEpubFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.epub') || file.type === 'application/epub+zip';
}

export function isSupportedPublicationFile(file: File): boolean {
  return isEpubFile(file) || isPdfFile(file);
}

export async function loadPublication(file: File): Promise<CanonicalBook> {
  if (isPdfFile(file)) {
    return loadPdfBook(file);
  }

  if (isEpubFile(file)) {
    return loadEpubBook(file);
  }

  throw new Error('Please upload a valid .epub or .pdf file.');
}

export { revokeBookResources };
