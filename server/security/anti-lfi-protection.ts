/**
 * 🛡️ ANTI-LFI (LOCAL FILE INCLUSION) PROTECTION
 * Proteção ultra-avançada contra Local File Inclusion
 * - Path traversal detection
 * - Whitelist validation
 * - Directory traversal prevention
 * - Symbolic link attack prevention
 */

import { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { addSuspiciousIPToPermanentBlacklist } from './persistent-ip-blacklist';

export class AntiLFIProtection {
  private static instance: AntiLFIProtection;
  private readonly allowedPaths: Set<string> = new Set();
  private readonly allowedExtensions: Set<string> = new Set(['.jpg', '.jpeg', '.png', '.pdf', '.txt']);

  public static getInstance(): AntiLFIProtection {
    if (!AntiLFIProtection.instance) {
      AntiLFIProtection.instance = new AntiLFIProtection();
    }
    return AntiLFIProtection.instance;
  }

  /**
   * 🔍 PADRÕES DE PATH TRAVERSAL
   */
  private readonly traversalPatterns = [
    /\.\./g,                    // ..
    /\.\.%2f/gi,                // URL encoded ../
    /\.\.%5c/gi,                // URL encoded ..\
    /%2e%2e/gi,                 // Double URL encoded ..
    /\.\.\\/g,                  // ..\
    /\.\.\//g,                  // ../
    /%252e%252e/gi,             // Triple URL encoded ..
    /\.\.%c0%af/gi,             // Unicode bypass
    /\.\.%c1%9c/gi,             // Unicode bypass
    /\.\/%2e%2e\//gi,           // Mixed encoding
    /~root/gi,                  // Unix home directory
    /~admin/gi,                 // Admin home directory
    /\/etc\//gi,                // Unix system files
    /\/proc\//gi,               // Linux proc filesystem
    /\/var\//gi,                // Unix var directory
    /\/usr\//gi,                // Unix usr directory
    /\/bin\//gi,                // Unix bin directory
    /C:\\Windows/gi,            // Windows system
    /C:\\Program Files/gi,      // Windows programs
    /\\\\[\w.-]+/g,             // UNC paths
    /file:\/\//gi,              // File protocol
    /php:\/\//gi,               // PHP wrapper
    /data:\/\//gi,              // Data protocol
    /expect:\/\//gi,            // Expect protocol
    /zip:\/\//gi,               // Zip wrapper
    /phar:\/\//gi,              // Phar wrapper
    /\.\.;/g,                   // Null byte bypass
    /\x00/g,                    // Null byte
    /\%00/gi                    // URL encoded null byte
  ];

  /**
   * 🛡️ DETECTAR PATH TRAVERSAL
   */
  public detectPathTraversal(input: string): boolean {
    if (typeof input !== 'string') return false;
    
    // Decode múltiplas vezes para pegar bypass duplo/triplo encoding
    let decoded = input;
    for (let i = 0; i < 3; i++) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch (e) {
        break;
      }
    }
    
    // Verificar padrões de traversal
    return this.traversalPatterns.some(pattern => pattern.test(decoded));
  }

  /**
   * 🔒 VALIDAR CAMINHO SEGURO
   */
  public validatePath(filePath: string, baseDir: string): boolean {
    try {
      // Normalizar o caminho
      const normalized = path.normalize(filePath);
      const resolved = path.resolve(baseDir, normalized);
      const base = path.resolve(baseDir);
      
      // Verificar se está dentro do diretório permitido
      if (!resolved.startsWith(base)) {
        console.warn(`⚠️ Path traversal attempt: ${filePath} escapes base ${baseDir}`);
        return false;
      }
      
      // Verificar se não é link simbólico
      if (fs.existsSync(resolved)) {
        const stats = fs.lstatSync(resolved);
        if (stats.isSymbolicLink()) {
          console.warn(`⚠️ Symbolic link detected: ${filePath}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error(`❌ Path validation error:`, error);
      return false;
    }
  }

  /**
   * 🧹 SANITIZAR CAMINHO
   */
  public sanitizePath(input: string): string {
    if (typeof input !== 'string') return '';
    
    return input
      .replace(/\.\./g, '')       // Remove ..
      .replace(/\\/g, '/')        // Normaliza separadores
      .replace(/\/+/g, '/')       // Remove barras duplicadas
      .replace(/^\//, '')         // Remove barra inicial
      .replace(/\0/g, '')         // Remove null bytes
      .trim();
  }

  /**
   * 🚫 MIDDLEWARE DE DETECÇÃO LFI
   */
  public lfiDetector() {
    return (req: Request, res: Response, next: NextFunction) => {
      const checkForLFI = (obj: any, path: string = ''): boolean => {
        if (typeof obj === 'string') {
          if (this.detectPathTraversal(obj)) {
            console.error(`🚨 LFI DETECTED in ${path}: ${obj.substring(0, 100)}`);
            return true;
          }
        } else if (Array.isArray(obj)) {
          return obj.some((item, index) => checkForLFI(item, `${path}[${index}]`));
        } else if (typeof obj === 'object' && obj !== null) {
          return Object.entries(obj).some(([key, value]) => 
            checkForLFI(value, path ? `${path}.${key}` : key)
          );
        }
        return false;
      };

      // Verificar body, query, params e headers específicos
      if (checkForLFI(req.body, 'body') || 
          checkForLFI(req.query, 'query') || 
          checkForLFI(req.params, 'params') ||
          checkForLFI(req.headers.referer, 'headers.referer') ||
          checkForLFI(req.headers['x-forwarded-for'], 'headers.x-forwarded-for')) {
        
        console.error(`🚨 LFI ATTACK BLOCKED from IP: ${req.ip}`);
        
        // 🔥 BLOQUEIO AUTOMÁTICO DE IP (CRITICAL SEVERITY - bloqueio imediato)
        addSuspiciousIPToPermanentBlacklist(
          req.ip, 
          `LFI/Path Traversal attempt on ${req.method} ${req.path}`, 
          'critical'
        ).catch(err => console.error('❌ Erro ao bloquear IP:', err));
        
        return res.status(400).json({
          success: false,
          error: 'Tentativa de acesso a arquivo não autorizado detectada'
        });
      }

      next();
    };
  }

  /**
   * 🔐 MIDDLEWARE DE VALIDAÇÃO DE ARQUIVO
   */
  public fileAccessValidator(baseDir: string, allowedExtensions?: string[]) {
    return (req: Request, res: Response, next: NextFunction) => {
      const filePath = req.params.file || req.query.file || req.body.file;
      
      if (!filePath) {
        return next();
      }

      // Validar caminho
      if (!this.validatePath(filePath as string, baseDir)) {
        console.error(`🚨 Invalid file path access attempt: ${filePath} from ${req.ip}`);
        return res.status(403).json({
          success: false,
          error: 'Acesso negado ao arquivo'
        });
      }

      // Validar extensão se especificada
      if (allowedExtensions) {
        const ext = path.extname(filePath as string).toLowerCase();
        if (!allowedExtensions.includes(ext)) {
          console.error(`🚨 Invalid file extension: ${ext} from ${req.ip}`);
          return res.status(403).json({
            success: false,
            error: 'Tipo de arquivo não permitido'
          });
        }
      }

      next();
    };
  }

  /**
   * 📁 ADICIONAR DIRETÓRIO À WHITELIST
   */
  public addAllowedPath(dirPath: string): void {
    const resolved = path.resolve(dirPath);
    this.allowedPaths.add(resolved);
    console.log(`✅ Path added to whitelist: ${resolved}`);
  }

  /**
   * 🔍 VERIFICAR SE CAMINHO ESTÁ NA WHITELIST
   */
  public isPathAllowed(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    
    for (const allowedPath of this.allowedPaths) {
      if (resolved.startsWith(allowedPath)) {
        return true;
      }
    }
    
    return false;
  }
}

export const lfiProtection = AntiLFIProtection.getInstance();
