import { Logger } from "@medusajs/framework/types";
import {
  AdminApiClient,
  createAdminApiClient,
} from "@shopify/admin-api-client";

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
  metafields: Array<{
    id: string;
    namespace: string;
    key: string;
    value: string;
    type: string;
  }>;
};

export type ShopifyProduct = {
  id: string;
  title: string;
  descriptionHtml: string | null;
  options: Array<{ name: string; values: string[] }>;
  images: ShopifyImage[];
  variants: ShopifyVariant[];
};

export type ShopifyCategory = {
  id: string;
  title: string;
  handle: string;
  productIds: string[];
};

type ModuleOptions = {
  storeDomain: string;
  adminToken: string;
};

const POLLING_DELAY_MS = 2000;

const BULK_OPERATION_QUERY_CATEGORIES = `
{
  collections {
    edges {
      node {
        id
        title
        handle
        products {
          edges {
            node { id __parentId: id }
          }
        }
      }
    }
  }
}`;

const BULK_OPERATION_QUERY_PRODUCTS = `
{
  products {
    edges {
      node {
        id
        title
        descriptionHtml
        options {
          name
          values
        }
        images {
          edges {
            node { id url altText __parentId: id }
          }
        }
        variants {
          edges {
            node {
              id
              title
              sku
              price
              inventoryQuantity
              selectedOptions { name value }
              metafields {
                edges {
                  node { id namespace key value type __parentId: id }
                }
              }
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

  constructor({ logger }: { logger: Logger }, options: ModuleOptions) {
    this.options_ = options;
    logger.info("Initializing Shopify service");
    this.shopifyClient = createAdminApiClient({
      storeDomain: options.storeDomain,
      accessToken: options.adminToken,
      apiVersion: "2025-01",
    });
  }

  private mapBulkData(lines: string[], type: "products" | "categories"): any[] {
    if (type === "categories") {
      const collectionsMap = new Map<string, any>();
      lines.forEach((line) => {
        const item = JSON.parse(line);
        if (item.__parentId === undefined) {
          collectionsMap.set(item.id, { ...item, products: [] });
        } else {
          const parent = collectionsMap.get(item.__parentId);
          if (parent) {
            parent.products.push(item);
          }
        }
      });
      return Array.from(collectionsMap.values());
    } else {
      // Para productos, necesitamos reconstruir la estructura anidada
      const productsMap = new Map<string, any>();

      lines.forEach((line) => {
        const item = JSON.parse(line);
        if (item.__parentId === undefined) {
          // Es un producto raíz
          productsMap.set(item.id, {
            ...item,
            images: { edges: [] },
            variants: { edges: [] },
          });
        } else {
          // Es una imagen o variante
          const parent = productsMap.get(item.__parentId);
          if (parent) {
            if (item.id.includes("Image")) {
              parent.images.edges.push({ node: item });
            } else if (item.id.includes("Variant")) {
              parent.variants.edges.push({ node: item });
            } else if (item.id.includes("Metafield")) {
              // Buscar la variante padre
              const variantParent = Array.from(productsMap.values())
                .flatMap((p) => p.variants.edges)
                .find((v) => v.node.id === item.__parentId);
              if (variantParent) {
                if (!variantParent.node.metafields) {
                  variantParent.node.metafields = { edges: [] };
                }
                variantParent.node.metafields.edges.push({ node: item });
              }
            }
          }
        }
      });

      return Array.from(productsMap.values());
    }
  }

  private async runBulkOperation(
    query: string,
    type: "products" | "categories"
  ): Promise<any[]> {
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

  /** Obtiene todos los productos */
  async getProducts(): Promise<ShopifyProduct[]> {
    const rows = await this.runBulkOperation(
      BULK_OPERATION_QUERY_PRODUCTS,
      "products"
    );
    const products = rows.map((p: any) => ({
      id: p.id,
      title: p.title,
      descriptionHtml: p.descriptionHtml,
      options: p.options || [],
      images: p.images.edges.map((img: any) => ({
        id: img.node.id,
        url: img.node.url,
        altText: img.node.altText,
      })),
      variants: p.variants.edges.map((v: any) => ({
        id: v.node.id,
        title: v.node.title,
        sku: v.node.sku,
        price: v.node.price,
        inventoryQuantity: v.node.inventoryQuantity,
        selectedOptions: v.node.selectedOptions || [],
        metafields:
          v.node.metafields?.edges?.map((mf: any) => ({
            id: mf.node.id,
            namespace: mf.node.namespace,
            key: mf.node.key,
            value: mf.node.value,
            type: mf.node.type,
          })) || [],
      })),
    }));

    console.log(
      "Processed products structure:",
      JSON.stringify(products.slice(0, 1), null, 2)
    );
    return products;
  }

  /** Obtiene todas las categorías con sus IDs de producto */
  async getCategories(): Promise<ShopifyCategory[]> {
    const rows = await this.runBulkOperation(
      BULK_OPERATION_QUERY_CATEGORIES,
      "categories"
    );
    return rows.map((c: any) => ({
      id: c.id,
      title: c.title,
      handle: c.handle,
      productIds: c.products.map((p: any) => p.id),
    }));
  }
}
