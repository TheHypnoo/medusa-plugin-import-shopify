import { Logger } from "@medusajs/framework/types";
import {
  AdminApiClient,
  createAdminApiClient,
} from "@shopify/admin-api-client";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import axios from "axios";

type ShopifyImage = {
  id: string;
  url: string;
  altText: string | null;
};

type ShopifyVariant = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  inventoryQuantity: number | null;
  selectedOptions: Array<{ name: string; value: string }>;
  metafields: Record<string, string>;
};

export type ShopifyProduct = {
  id: string;
  title: string;
  status: string;
  description: string | null;
  options: Array<{ name: string; values: string[] }>;
  tags: string[];
  metafields: Record<string, string>;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
  collections?: Array<{
    id: string;
    title: string;
    description: string | null;
  }>;
};

export type ShopifyCategory = {
  id: string;
  title: string;
};

type ModuleOptions = {
  storeDomain: string;
  adminToken: string;
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_S3_BUCKET: string;
};

const POLLING_DELAY_MS = 2000;

const BULK_OPERATION_QUERY_CATEGORIES = `
{
  collections {
    edges {
      node {
        id
        title
        description
      }
    }
  }
}`;

const BULK_OPERATION_QUERY_PRODUCTS_CORE = `
{
  products(query: "status:ACTIVE,DRAFT") {
    edges {
      node {
        id
        title
        status
        description
        options { name values }
        tags
        metafields { edges { node { id namespace key value type __parentId: id } } }
        images { edges { node { id url altText __parentId: id } } }
        variants {
          edges {
            node {
              id
              title
              sku
              price
              inventoryQuantity
              selectedOptions { name value }
              metafields { edges { node { id namespace key value type __parentId: id } } }
            }
          }
        }
      }
    }
  }
}`;

const BULK_OPERATION_QUERY_PRODUCTS_COLLECTIONS = `
{
  products(query: "status:ACTIVE,DRAFT") {
    edges {
      node {
        id
        collections {
          edges {
            node {
              id
              title
              description
            }
          }
        }
      }
    }
  }
}`;

export default class ShopifyService {
  protected shopifyClient: AdminApiClient;
  protected options_: ModuleOptions;
  protected s3Client: S3Client;

  constructor({ logger }: { logger: Logger }, options: ModuleOptions) {
    this.options_ = options;
    logger.info("Initializing Shopify service");
    this.shopifyClient = createAdminApiClient({
      storeDomain: options.storeDomain,
      accessToken: options.adminToken,
      apiVersion: "2025-07",
    });

    // Configurar axios con retry automático para descargas de imágenes
    axios.defaults.timeout = 30000; // 30 segundos timeout global
    axios.defaults.maxRedirects = 5; // Máximo 5 redirecciones

    if (
      !options.AWS_REGION ||
      !options.AWS_ACCESS_KEY_ID ||
      !options.AWS_SECRET_ACCESS_KEY
    ) {
      logger.info(
        "AWS credentials not provided, skipping S3 client initialization"
      );
      return;
    }
    logger.info("Initializing AWS S3 client");

    this.s3Client = new S3Client({
      region: options.AWS_REGION,
      credentials: {
        accessKeyId: options.AWS_ACCESS_KEY_ID,
        secretAccessKey: options.AWS_SECRET_ACCESS_KEY,
      },
      maxAttempts: 3, // AWS SDK retry automático
    });
  }

  private mapBulkData(lines: string[], type: "products" | "categories"): any[] {
    if (type === "categories") {
      const collectionsMap = new Map<string, any>();
      lines.forEach((line) => {
        const item = JSON.parse(line);
        if (item.__parentId === undefined) {
          collectionsMap.set(item.id, { ...item });
        }
      });
      // Devolver como array de ShopifyCategory
      const allCategories = Array.from(collectionsMap.values()).map((c) => ({
        id: c.id,
        title: c.title,
        handle: c.handle,
      }));

      // Eliminar categorías con nombres duplicados (dejar solo la primera)
      const seenCategoryTitles = new Set<string>();
      const uniqueCategories: ShopifyCategory[] = [];
      const removedCategoryIds: string[] = [];
      for (const cat of allCategories) {
        if (!seenCategoryTitles.has(cat.title)) {
          seenCategoryTitles.add(cat.title);
          uniqueCategories.push(cat as ShopifyCategory);
        } else {
          removedCategoryIds.push(cat.id);
        }
      }
      if (removedCategoryIds.length > 0) {
        console.log(
          `Categorías eliminadas con nombre duplicado: ${removedCategoryIds.length}`
        );
      }
      return uniqueCategories;
    } else {
      // Para productos, necesitamos reconstruir la estructura anidada y devolver arrays planos
      const productsMap = new Map<string, any>();

      // PRIMERA PASADA: crear todos los productos raíz (aunque solo tengan id)
      lines.forEach((line) => {
        const item = JSON.parse(line);
        if (item.__parentId === undefined) {
          productsMap.set(item.id, {
            ...item,
            images: [],
            variants: [],
            metafields: {},
            collections: [],
          });
        }
      });

      // SEGUNDA PASADA: asociar imágenes, variantes y colecciones
      lines.forEach((line) => {
        const item = JSON.parse(line);
        if (item.__parentId !== undefined) {
          const parent = productsMap.get(item.__parentId);
          if (parent) {
            if (item.id.includes("Image")) {
              parent.images.push(item);
            } else if (item.id.includes("Variant")) {
              const variant = { ...item, metafields: {} };
              parent.variants.push(variant);
            } else if (item.id.includes("Collection")) {
              parent.collections = parent.collections || [];
              parent.collections.push({
                id: item.id,
                title: item.title,
                description: item.description ?? null,
              });
            }
          }
        }
      });

      // TERCERA PASADA: asociar metafields a productos o variantes
      lines.forEach((line) => {
        const item = JSON.parse(line);
        if (item.__parentId !== undefined && item.id.includes("Metafield")) {
          // Buscar el producto padre
          for (const [productId, product] of productsMap.entries()) {
            // Buscar en las variantes del producto
            const variantParent = product.variants.find(
              (v: any) => v.id === item.__parentId
            );
            if (variantParent) {
              // Es metafield de variante
              variantParent.metafields[item.key] = item.value;
              break;
            } else if (productId === item.__parentId) {
              // Es metafield de producto
              product.metafields[item.key] = item.value;
              break;
            }
          }
        }
      });

      // Función para limpiar emojis
      const cleanTitle = (title: string) =>
        title
          .replace(
            /([\u2700-\u27BF]|[\uE000-\uF8FF]|[\uD83C-\uDBFF\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83D[\uDC00-\uDE4F])/g,
            ""
          )
          .replace(/\p{Emoji_Presentation}/gu, "")
          .trim();

      // Si los productos solo tienen id y collections (caso de la query de colecciones), devolver solo eso
      const productsArr = Array.from(productsMap.values()).map((p) => {
        // Mapeo completo para productos con todos los datos
        return {
          id: p.id,
          title: cleanTitle(p.title ?? ""),
          status: p?.status,
          description: p?.description,
          options: p?.options || [],
          tags: p?.tags || [],
          metafields: p?.metafields || {},
          images: p?.images || [],
          variants: (p?.variants || []).map((v: ShopifyVariant) => ({
            id: v.id,
            title: v.title ?? "",
            sku: v.sku,
            price: v.price,
            inventoryQuantity: v.inventoryQuantity,
            selectedOptions: v.selectedOptions || [],
            metafields: v.metafields || {},
          })),
          collections: (p?.collections || []).map((c: any) => ({
            id: c.id,
            title: c.title,
            description: c.description ?? null,
          })),
        };
      });

      // Eliminar productos con títulos duplicados (dejar solo el primero)
      const seenTitles = new Set<string>();
      const uniqueProducts: ShopifyProduct[] = [];
      const removedProductIds: string[] = [];
      for (const prod of productsArr) {
        if (!prod.title) {
          uniqueProducts.push(prod as ShopifyProduct);
          continue;
        }
        if (!seenTitles.has(prod.title)) {
          seenTitles.add(prod.title);
          uniqueProducts.push(prod as ShopifyProduct);
        } else {
          removedProductIds.push(prod.id);
        }
      }
      if (removedProductIds.length > 0) {
        console.log(
          `Productos eliminados con titulo duplicado: ${removedProductIds.length}`
        );
      }

      // Eliminar SKUs duplicados de variantes (dejando solo la primera aparición global)
      const seenSkus = new Set<string>();
      const removedVariantSkus: string[] = [];
      for (const prod of uniqueProducts) {
        if (!prod.variants) {
          continue;
        }
        if (prod.variants && prod.variants.length > 0) {
          for (const variant of prod.variants) {
            if (variant.sku && seenSkus.has(variant.sku)) {
              removedVariantSkus.push(variant.sku);
              variant.sku = null; // Eliminar solo el SKU, mantener la variante
            } else if (variant.sku) {
              seenSkus.add(variant.sku);
            }
          }
        }
      }
      if (removedVariantSkus.length > 0) {
        console.log(
          `SKUs eliminados de variantes duplicadas: ${removedVariantSkus.length}`
        );
      }

      return uniqueProducts;
    }
  }

  private async runBulkOperation(
    query: string,
    type: "products" | "categories",
    testUrl?: string
  ): Promise<any[]> {
    if (testUrl) {
      // Si se pasa testUrl, saltar toda la lógica y hacer fetch directo
      const response = await fetch(testUrl);
      const text = await response.text();
      const lines = text.trim().split("\n").filter(Boolean);
      return this.mapBulkData(lines, type);
    }
    // 1) Cancelar cualquier operación activa
    const currentRes = await this.shopifyClient.request<{
      currentBulkOperation: { id: string; status: string } | null;
    }>(`query { currentBulkOperation { id status } }`);

    const currentOp = currentRes?.data?.currentBulkOperation;
    if (currentOp && currentOp.status === "RUNNING") {
      await this.shopifyClient.request(
        `mutation CancelBulk($id: ID!) {
           bulkOperationCancel(id: $id) {
             bulkOperation { status }
             userErrors { message }
           }
         }`,
        { variables: { id: currentOp.id } }
      );
      // Esperar a que se marque como CANCELED
      let canceled = false;
      while (!canceled) {
        await new Promise((r) => setTimeout(r, POLLING_DELAY_MS));
        const statusRes = await this.shopifyClient.request<{
          currentBulkOperation: { id: string; status: string } | null;
        }>(`query { currentBulkOperation { status } }`);
        if (statusRes?.data?.currentBulkOperation?.status === "CANCELED") {
          canceled = true;
        }
      }
    }

    // 2) Lanzar la nueva operación
    const runRes = await this.shopifyClient.request<{
      bulkOperationRunQuery: {
        bulkOperation: { id: string; status: string };
        userErrors: Array<{ message: string }>;
      };
    }>(
      `mutation RunBulk($query: String!) {
         bulkOperationRunQuery(query: $query) {
           bulkOperation { id status }
           userErrors { message }
         }
       }`,
      { variables: { query } }
    );

    if (runRes?.data?.bulkOperationRunQuery?.userErrors?.length) {
      throw new Error(
        `Errores al iniciar bulk: ${runRes?.data?.bulkOperationRunQuery?.userErrors
          .map((e) => e.message)
          .join(", ")}`
      );
    }

    // 3) Polling hasta COMPLETED o FAILED
    let completed = false;
    let resultUrl: string | null = null;

    while (!completed) {
      await new Promise((r) => setTimeout(r, POLLING_DELAY_MS));
      const res = await this.shopifyClient.request<{
        currentBulkOperation: {
          status: string;
          url: string | null;
          errorCode: string | null;
        } | null;
      }>(`query { currentBulkOperation { status url errorCode } }`);

      const op = res?.data?.currentBulkOperation;
      if (!op) {
        throw new Error("No hay operación bulk activa");
      }
      console.log("op", op);
      if (op.status === "COMPLETED") {
        resultUrl = op.url;
        completed = true;
      } else if (op.status === "FAILED") {
        console.log("op", op);
        throw new Error(`Bulk operation failed: ${op.errorCode}`);
      }
    }

    if (!resultUrl) {
      return [];
    }

    // 4) Fetch y parseo de JSONL
    const response = await fetch(resultUrl);
    const text = await response.text();
    const lines = text.trim().split("\n").filter(Boolean);

    return this.mapBulkData(lines, type);
  }

  /** Obtiene todos los productos y sube sus imágenes a S3, reemplazando las URLs, incluyendo sus colecciones asociadas */
  async getProducts(): Promise<ShopifyProduct[]> {
    // 1. Bulk operation para productos (sin collections)
    const rows = await this.runBulkOperation(
      BULK_OPERATION_QUERY_PRODUCTS_CORE,
      "products"
    );

    const products = rows;

    // 2. Bulk operation para colecciones de productos
    const collectionsRows = await this.runBulkOperation(
      BULK_OPERATION_QUERY_PRODUCTS_COLLECTIONS,
      "products"
    );

    // Mapear colecciones por id de producto
    const collectionsByProductId: Record<
      string,
      Array<{ id: string; title: string; description: string | null }>
    > = {};
    for (const prod of collectionsRows) {
      if (prod.collections && Array.isArray(prod.collections)) {
        collectionsByProductId[prod.id] = prod.collections.map((c: any) => ({
          id: c.id,
          title: c.title,
          description: c.description ?? null,
        }));
      }
    }

    // Asociar colecciones a cada producto antes de procesar imágenes
    for (const product of products) {
      product.collections = collectionsByProductId[product.id] || [];
    }

    // Subir imágenes a S3 y reemplazar URLs con concurrencia controlada
    const processProductImages = async (product: ShopifyProduct) => {
      if (product.images && product.images.length > 0) {
        product.images = await Promise.all(
          product.images.map(async (img: ShopifyImage) => {
            const s3Url = await this.uploadImageUrlToS3(
              img.url,
              product.id,
              product.title
            );

            return {
              ...img,
              url: s3Url || img.url,
            };
          })
        );
      }
      return product;
    };

    // Procesar productos en lotes para evitar sobrecargar la memoria y conexiones
    const BATCH_SIZE = 5; // Procesar 5 productos a la vez para evitar rate limiting
    const processedProducts: ShopifyProduct[] = [];

    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(processProductImages));
      processedProducts.push(...batchResults);

      console.log(
        `✅ Procesados productos ${i + 1}-${Math.min(
          i + BATCH_SIZE,
          products.length
        )} de ${products.length}`
      );

      // Pequeño delay entre lotes para evitar rate limiting
      if (i + BATCH_SIZE < products.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 segundo entre lotes
      }
    }

    console.log("Products length: ", processedProducts.length);

    return processedProducts;
  }

  /** Obtiene todas las categorías con sus IDs de producto */
  async getCategories(): Promise<ShopifyCategory[]> {
    const rows = await this.runBulkOperation(
      BULK_OPERATION_QUERY_CATEGORIES,
      "categories"
    );
    console.log("Categories length: ", rows.length);

    return rows.map((c: ShopifyCategory) => ({
      id: c.id,
      title: c.title,
    }));
  }

  /**
   * Descarga una imagen con retry automático para manejar errores de red
   */
  private async downloadImageWithRetry(
    url: string,
    maxRetries: number = 3
  ): Promise<any> {
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 30000, // 30 segundos timeout
          validateStatus: (status) => status === 200,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; Shopify-Image-Downloader/1.0)",
          },
        });

        return response;
      } catch (error: any) {
        lastError = error;

        // Si es un error de DNS o red, esperar antes de reintentar
        if (
          error.code === "ENOTFOUND" ||
          error.code === "ECONNRESET" ||
          error.code === "ETIMEDOUT"
        ) {
          const delay = Math.min(1000 * attempt, 5000); // Delay exponencial, máximo 5 segundos
          console.warn(
            `⚠️ Error de red (intento ${attempt}/${maxRetries}) para ${url}: ${error.message}. Esperando ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else if (attempt < maxRetries) {
          console.warn(
            `⚠️ Error descargando imagen (intento ${attempt}/${maxRetries}): ${url} - ${error.message}`
          );
        } else {
          console.error(
            `❌ Error definitivo descargando imagen: ${url} - ${error.message}`
          );
        }
      }
    }

    throw lastError;
  }

  /**
   * Descarga una imagen desde una URL y la sube a S3 usando lib-storage
   * con manejo automático de reintentos y mejor gestión de errores
   */
  async uploadImageUrlToS3(
    url: string,
    productId: string,
    productTitle: string
  ): Promise<string | null> {
    if (!this.s3Client) {
      console.warn("S3 client not initialized, skipping image upload");
      return null;
    }

    if (!this.options_.AWS_S3_BUCKET) {
      console.warn("AWS_S3_BUCKET not set, skipping image upload");
      return null;
    }

    try {
      // Configurar axios con retry automático para descargar la imagen
      const response = await this.downloadImageWithRetry(url);

      const contentType = response.headers["content-type"];
      if (!contentType || !contentType.startsWith("image/")) {
        console.warn(`Invalid content type for image ${url}: ${contentType}`);
        return null;
      }

      // Obtener el nombre del archivo original de la URL
      const urlParts = url.split("?")[0].split("/");
      const originalFileName = urlParts[urlParts.length - 1];

      // Verificar si el archivo ya existe en S3
      try {
        await this.s3Client.send(
          new HeadObjectCommand({
            Bucket: this.options_.AWS_S3_BUCKET,
            Key: originalFileName,
          })
        );

        // Si llegamos aquí, el archivo ya existe
        const existingUrl = `https://${this.options_.AWS_S3_BUCKET}.s3.${this.options_.AWS_REGION}.amazonaws.com/${originalFileName}`;
        return existingUrl;
      } catch (error: any) {
        // Si el error es 404 (NoSuchKey), el archivo no existe y podemos subirlo
        if (error.name !== "NotFound" && error.name !== "NoSuchKey") {
          console.warn(
            `⚠️ Error verificando archivo existente ${originalFileName}:`,
            error.message
          );
        }
      }

      // Usar lib-storage Upload para mejor manejo de uploads con retry automático
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.options_.AWS_S3_BUCKET,
          Key: originalFileName,
          Body: Buffer.from(response.data),
          ContentType: contentType,
          ACL: "public-read",
          Metadata: {
            "original-url": url,
            "product-id": productId,
            "product-title": productTitle,
            "uploaded-at": new Date().toISOString(),
          },
        },
        queueSize: 1, // Para archivos pequeños, no necesitamos multiparte
        partSize: 1024 * 1024 * 5, // 5MB por parte
        leavePartsOnError: false,
      });

      await upload.done();

      // Construir la URL pública
      const publicUrl = `https://${this.options_.AWS_S3_BUCKET}.s3.${this.options_.AWS_REGION}.amazonaws.com/${originalFileName}`;

      console.log(
        `✅ Imagen subida exitosamente: ${url} → ${publicUrl} (producto: ${productTitle})`
      );
      return publicUrl;
    } catch (error) {
      console.error(
        `❌ Error subiendo imagen a S3 para producto ${productId} (${productTitle}): ${url}`,
        error
      );
      return null;
    }
  }
}
