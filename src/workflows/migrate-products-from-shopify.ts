import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  CreateProductWorkflowInputDTO,
  UpsertProductDTO,
  ProductStatus,
  CreateProductDTO,
} from "@medusajs/framework/types";
import {
  createProductsWorkflow,
  updateProductsWorkflow,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows";
import { getShopifyProductsStep } from "./steps/get-shopify-products";

export const migrateProductsFromShopifyWorkflowId =
  "migrate-products-from-shopify";

export const migrateProductsFromShopify = createWorkflow(
  {
    name: migrateProductsFromShopifyWorkflowId,
    retentionTime: 10000,
    store: true,
  },
  () => {
    // const products = getShopifyProductsStep();

    const { data: stores } = useQueryGraphStep({
      entity: "store",
      fields: ["supported_currencies.*", "default_sales_channel_id"],
      pagination: { take: 1, skip: 0 },
    });

    /*     const externalIdFilters = transform({ products }, (data) => {
      return data.products.map((p) => p.id);
    });

    const { data: existingProducts } = useQueryGraphStep({
      entity: "product",
      fields: ["id", "external_id", "variants.id", "variants.metadata"],
      filters: { external_id: externalIdFilters },
    }).config({ name: "get-existing-products" });
 */
    /*

    const { productsToCreate, productsToUpdate } = transform(
      { products, stores, existingProducts },
      (data) => {
        const toCreate: CreateProductWorkflowInputDTO[] = [];
        const toUpdate: UpsertProductDTO[] = [];

        data.products.forEach((shopifyProduct) => {
          const existing = data.existingProducts.find(
            (p) => p.external_id === shopifyProduct.id.split("/").pop()
          );
          const productData: CreateProductWorkflowInputDTO = {
            title: shopifyProduct.title || "Title not found",
            description: shopifyProduct.descriptionHtml?.toString() || "",
            /* options: shopifyProduct.options.map((option) => ({
              title: option.name,
              values: option.values,
            })), */
    /*
            status: "published" as ProductStatus,
            handle:
              `${shopifyProduct.title
                .toLowerCase()
                .replace(/\s+/g, "-")}-${shopifyProduct.id.split("/").pop()}` ||
              "Handle not found",
            external_id:
              shopifyProduct.id.split("/").pop() || "External ID not found",
            sales_channels: [{ id: data.stores[0].default_sales_channel_id }],
            /* images: shopifyProduct.images.map((img) => ({
              url: img.url,
              metadata: { external_id: img.id },
            })), */
    /*  variants: shopifyProduct.variants.map((variant) => {
              const existingVariant = existing?.variants.find(
                (v) => v.metadata?.external_id === variant.id
              );
              return {
                id: existingVariant?.id,
                title: variant.title,
                sku: variant.sku || undefined,
                options: Object.fromEntries(
                  variant.selectedOptions.map((so) => [so.name, so.value])
                ),
                prices: data.stores[0].supported_currencies.map(
                  ({ currency_code }) => ({
                    amount: parseFloat(variant.price),
                    currency_code,
                  })
                ),
                inventory_quantity: variant.inventoryQuantity ?? 0,
                metadata: { external_id: variant.id },
              };
            }), */
    /*
          };

          if (existing) {
            productData.id = existing.id;
            toUpdate.push(productData as UpsertProductDTO);
          } else {
            toCreate.push(productData as CreateProductWorkflowInputDTO);
          }
        });

        return {
          productsToCreate: toCreate,
          productsToUpdate: [],
        };
      }
    );

    */

    createProductsWorkflow.runAsStep({
      input: {
        products: [
          {
            title: "T-shirt test",
            description: "Description test",
            status: "published" as ProductStatus,
            handle: "t-shirt-test",
            external_id: "1234567890",
            sales_channels: [{ id: stores[0].default_sales_channel_id }],
          },
        ],
      },
    });

    /*  updateProductsWorkflow.runAsStep({
      input: { products: productsToUpdate },
    }); */

    return new WorkflowResponse({ count: 1 });
  }
);
