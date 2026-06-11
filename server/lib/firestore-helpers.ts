/**
 * 🧹 FIRESTORE HELPERS - Utilitários para trabalhar com Firestore
 * 
 * Remove campos `undefined` de objetos antes de salvar no Firestore
 * (Firestore rejeita `undefined`, mas aceita `null`)
 */

import { FieldValue } from 'firebase-admin/firestore';

/**
 * Remove recursivamente todos os campos com valor `undefined` de um objeto.
 * 
 * @param obj - Objeto a ser limpo
 * @returns Novo objeto sem campos `undefined`
 * 
 * PRESERVA:
 * - `null` (Firebase aceita null)
 * - Strings vazias `""`
 * - Arrays vazios `[]`
 * - Objetos vazios `{}`
 * - Datas
 * - FieldValue (deleteField, serverTimestamp, etc)
 * - Timestamp, DocumentReference e outros tipos especiais do Firestore
 * 
 * REMOVE:
 * - Campos com valor `undefined`
 * - Elementos `undefined` em arrays
 */
export function removeUndefinedDeep<T>(obj: T): T {
  // Se não é um objeto, retorna como está
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Preserva Datas
  if (obj instanceof Date) {
    return obj;
  }

  // Preserva FieldValue do Firestore (deleteField, serverTimestamp, etc)
  if (obj instanceof FieldValue) {
    return obj;
  }

  // Preserva outros tipos especiais do Firestore (Timestamp, DocumentReference, etc)
  // Detecta pelo construtor: se não é Object ou Array, é um tipo especial
  const constructor = (obj as any).constructor;
  if (constructor && constructor !== Object && constructor !== Array) {
    return obj;
  }

  // Se é um array, filtra undefined e processa recursivamente cada item
  if (Array.isArray(obj)) {
    return obj
      .filter(item => item !== undefined)
      .map(item => removeUndefinedDeep(item)) as T;
  }

  // Se é um objeto, processa recursivamente cada propriedade
  const result: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    // Pula campos undefined
    if (value === undefined) {
      continue;
    }

    // Processa recursivamente objetos e arrays
    if (value !== null && typeof value === 'object') {
      result[key] = removeUndefinedDeep(value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Valida se um objeto é seguro para ser salvo no Firestore
 * (não contém valores `undefined`)
 * 
 * @param obj - Objeto a ser validado
 * @returns true se o objeto é seguro, false caso contrário
 */
export function isFirestoreSafe(obj: any): boolean {
  if (obj === null || typeof obj !== 'object') {
    return obj !== undefined;
  }

  if (obj instanceof Date || obj instanceof FieldValue) {
    return true;
  }

  if (Array.isArray(obj)) {
    return obj.every(item => isFirestoreSafe(item));
  }

  return Object.values(obj).every(value => isFirestoreSafe(value));
}
