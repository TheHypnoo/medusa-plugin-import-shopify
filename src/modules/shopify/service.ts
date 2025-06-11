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

type ShopifyGraphQLResponse = {
  products: {
    pageInfo: {
      hasNextPage: boolean;
      endCursor: string;
    };
    edges: Array<{
      node: {
        id: string;
        title: string;
        descriptionHtml: string | null;
        images: {
          edges: Array<{
            node: {
              id: string;
              url: string;
              altText: string | null;
            };
          }>;
        };
        variants: {
          edges: Array<{
            node: {
              id: string;
              title: string;
              sku: string | null;
              price: string;
              inventoryQuantity: number | null;
              metafields: {
                edges: Array<{
                  node: {
                    id: string;
                    namespace: string;
                    key: string;
                    value: string;
                    type: string;
                  };
                }>;
              };
            };
          }>;
        };
      };
    }>;
  };
};

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

  protected async runBulkOperation(query: string): Promise<any[]> {
    await this.shopifyClient.request(
      `mutation RunBulk($query: String!) {\n        bulkOperationRunQuery(query: $query) {\n          bulkOperation { id status }\n          userErrors { message }\n        }\n      }`,
      {
        variables: { query },
      }
    );

    let completed = false;
    let url: string | null = null;
    while (!completed) {
      const res = await this.shopifyClient.request<any>(
        `query { currentBulkOperation { status url errorCode } }`
      );
      const op = res.data.currentBulkOperation;
      if (op?.status === "COMPLETED") {
        url = op.url;
        completed = true;
      } else if (op?.status === "FAILED") {
        throw new Error(`Bulk operation failed: ${op.errorCode}`);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
    if (!url) {
      return [];
    }
    const response = await fetch(url);
    const text = await response.text();
    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  /**
   * Obtiene todos los productos de Shopify, incluyendo variantes e imágenes.
   */
  async getProducts(): Promise<ShopifyProduct[]> {
    const rows = await this.runBulkOperation(`{ products { edges { node { id title descriptionHtml images(first: 100) { edges { node { id url altText } } } variants(first: 100) { edges { node { id title sku price inventoryQuantity } } } } } } }`);

    return rows.map((p: any) => {
      return {
        id: p.id,
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        images: p.images.edges.map((img: any) => ({
          id: img.node.id,
          url: img.node.url,
          altText: img.node.altText,
        })),
        variants: p.variants.edges.map((variant: any) => ({
          id: variant.node.id,
          title: variant.node.title,
          sku: variant.node.sku,
          price: variant.node.price,
          inventoryQuantity: variant.node.inventoryQuantity,
          metafields: [],
        })),
      } as ShopifyProduct;
    });
  }

  /**
   * Obtiene todas las categorías (colecciones) de Shopify junto con los productos asociados.
   */
  async getCategories(): Promise<ShopifyCategory[]> {
    const rows = await this.runBulkOperation(`{ collections { edges { node { id title handle products(first: 250) { edges { node { id } } } } } } }`);

    return rows.map((c: any) => ({
      id: c.id,
      title: c.title,
      handle: c.handle,
      productIds: c.products.edges.map((p: any) => p.node.id),
    }));
  }
}
