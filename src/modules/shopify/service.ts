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

  /**
   * Obtiene todos los productos de Shopify, incluyendo variantes e imágenes.
   */
  async getProducts(): Promise<ShopifyProduct[]> {
    const products: ShopifyProduct[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const response = await this.shopifyClient.request<ShopifyGraphQLResponse>(
        `query GetProducts($cursor: String) {
          products(first: 50, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                title
                descriptionHtml
                images(first: 10) {
                  edges {
                    node {
                      id
                      url
                      altText
                    }
                  }
                }
                variants(first: 10) {
                  edges {
                    node {
                      id
                      title
                      sku
                      price
                      inventoryQuantity
                      metafields(first: 100) {
                        edges {
                          node {
                            id
                            namespace
                            key
                            value
                            type
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
        {
          variables: cursor ? { cursor } : {},
        }
      );

      if (!response.data) {
        throw new Error("No data received from Shopify API");
      }

      const productData = response.data.products;

      for (const edge of productData.edges) {
        const product = edge.node;
        products.push({
          id: product.id,
          title: product.title,
          descriptionHtml: product.descriptionHtml,
          images: product.images.edges.map((img: any) => ({
            id: img.node.id,
            url: img.node.url,
            altText: img.node.altText,
          })),
          variants: product.variants.edges.map((variant: any) => ({
            id: variant.node.id,
            title: variant.node.title,
            sku: variant.node.sku,
            price: variant.node.price,
            inventoryQuantity: variant.node.inventoryQuantity,
            metafields: variant.node.metafields.edges.map((metafield: any) => ({
              id: metafield.node.id,
              namespace: metafield.node.namespace,
              key: metafield.node.key,
              value: metafield.node.value,
              type: metafield.node.type,
            })),
          })),
        });
      }

      hasNextPage = productData.pageInfo.hasNextPage;
      cursor = productData.pageInfo.endCursor;
    }

    return products;
  }
}
