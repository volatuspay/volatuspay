import { getBunnyCredentials } from '../lib/bunny-helper';

/**
 * 🗑️🔥 BUNNY CASCADE DELETE SERVICE
 * 
 * Serviço centralizado para deletar vídeos e imagens do Bunny.net em cascata
 * Usado por:
 * - Deleção de produtos (apaga todos módulos/aulas)
 * - Deleção de módulos (apaga todas aulas)
 * - Deleção de aulas individuais
 */

export interface BunnyCleanupResult {
  videosDeleted: number;
  videosFailed: number;
  imagesDeleted: number;
  imagesFailed: number;
  errors: string[];
}

/**
 * Deleta vídeos e imagens do Bunny.net em lote
 * 
 * @param videoGuids - Array de GUIDs de vídeos do Bunny Stream
 * @param imageUrls - Array de URLs completas de imagens do Bunny Storage
 * @returns Resultado da operação com contadores de sucesso/falha
 */
export async function cleanupBunnyResources(
  videoGuids: string[] = [],
  imageUrls: string[] = []
): Promise<BunnyCleanupResult> {
  console.log(`🗑️🔥 [BUNNY-CLEANUP] Iniciando cleanup - Vídeos: ${videoGuids.length}, Imagens: ${imageUrls.length}`);
  
  const credentials = await getBunnyCredentials();
  
  const results: BunnyCleanupResult = {
    videosDeleted: 0,
    videosFailed: 0,
    imagesDeleted: 0,
    imagesFailed: 0,
    errors: []
  };
  
  // DELETAR VÍDEOS DO BUNNY STREAM
  for (const guid of videoGuids) {
    if (!guid) continue;
    
    try {
      console.log(`🗑️ [BUNNY-CLEANUP] Deletando vídeo: ${guid}`);
      
      const response = await fetch(
        `https://video.bunnycdn.com/library/${credentials.streamLibraryId}/videos/${guid}`,
        {
          method: 'DELETE',
          headers: {
            'AccessKey': credentials.streamApiKey
          }
        }
      );
      
      if (!response.ok) {
        throw new Error(`Bunny API error: ${response.status}`);
      }
      
      results.videosDeleted++;
      console.log(`✅ [BUNNY-CLEANUP] Vídeo deletado: ${guid}`);
    } catch (error: any) {
      results.videosFailed++;
      results.errors.push(`Erro ao deletar vídeo ${guid}: ${error.message}`);
      console.error(`❌ [BUNNY-CLEANUP] Falha ao deletar vídeo ${guid}:`, error.message);
    }
  }
  
  // DELETAR IMAGENS DO BUNNY STORAGE
  for (const imageUrl of imageUrls) {
    if (!imageUrl) continue;
    
    try {
      // Extrair path da URL do Bunny CDN
      const match = imageUrl.match(/https:\/\/[^\/]+\.b-cdn\.net\/(.+)/);
      if (!match) {
        throw new Error('URL inválida do Bunny CDN');
      }
      
      const filePath = match[1];
      console.log(`🗑️ [BUNNY-CLEANUP] Deletando imagem: ${filePath}`);
      
      const response = await fetch(
        `https://storage.bunnycdn.com/${credentials.storageZoneName}/${filePath}`,
        {
          method: 'DELETE',
          headers: {
            'AccessKey': credentials.storageApiKey
          }
        }
      );
      
      if (!response.ok && response.status !== 404) {
        throw new Error(`Bunny Storage error: ${response.status}`);
      }
      
      results.imagesDeleted++;
      console.log(`✅ [BUNNY-CLEANUP] Imagem deletada: ${filePath}`);
    } catch (error: any) {
      results.imagesFailed++;
      results.errors.push(`Erro ao deletar imagem ${imageUrl}: ${error.message}`);
      console.error(`❌ [BUNNY-CLEANUP] Falha ao deletar imagem ${imageUrl}:`, error.message);
    }
  }
  
  console.log('✅ [BUNNY-CLEANUP] Cleanup concluído:', results);
  
  return results;
}

/**
 * Deleta vídeo único do Bunny Stream
 * 
 * @param guid - GUID do vídeo no Bunny Stream
 * @returns true se deletado com sucesso
 */
export async function deleteBunnyVideo(guid: string): Promise<boolean> {
  if (!guid) return false;
  
  const result = await cleanupBunnyResources([guid], []);
  return result.videosDeleted > 0;
}

/**
 * Deleta imagem única do Bunny Storage
 * 
 * @param imageUrl - URL completa da imagem no Bunny CDN
 * @returns true se deletado com sucesso
 */
export async function deleteBunnyImage(imageUrl: string): Promise<boolean> {
  if (!imageUrl) return false;
  
  const result = await cleanupBunnyResources([], [imageUrl]);
  return result.imagesDeleted > 0;
}
