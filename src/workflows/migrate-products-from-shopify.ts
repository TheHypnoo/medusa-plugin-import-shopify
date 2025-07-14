import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  CreateProductWorkflowInputDTO,
  UpsertProductDTO,
  ProductStatus,
} from "@medusajs/framework/types";
import {
  createProductsWorkflow,
  updateProductsWorkflow,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows";
import { getShopifyProductsStep } from "./steps/get-shopify-products";
import {
  getFloatFromMetafield,
  getBooleanFromMetafield,
  getStringFromMetafield,
} from "./utils/metafields";

export const migrateProductsFromShopifyWorkflowId =
  "migrate-products-from-shopify";

export const migrateProductsFromShopify = createWorkflow(
  {
    name: migrateProductsFromShopifyWorkflowId,
    retentionTime: 10000,
    store: true,
  },
  () => {
    const products = getShopifyProductsStep();

    const { data: stores } = useQueryGraphStep({
      entity: "store",
      fields: ["supported_currencies.*", "default_sales_channel_id"],
      pagination: { take: 1, skip: 0 },
    });

    const categoryExternalIds = transform(
      {
        products,
      },
      (data) => {
        const ids: string[] = [];
        data.products.map((product) => {
          if (!product.collections?.length) {
            return;
          }

          ids.push(...product.collections.map((c) => c.id));
        });
        return ids;
      }
    );

    const { data: categories } = useQueryGraphStep({
      entity: "product_category",
      fields: ["id", "metadata"],
      filters: {
        metadata: {
          external_id: categoryExternalIds,
        },
      },
    }).config({ name: "get-categories" });

    const externalIdFilters = transform({ products }, (data) => {
      return data.products.map((p) => p.id);
    });

    const { data: existingProducts } = useQueryGraphStep({
      entity: "product",
      fields: ["id", "external_id", "variants.id", "variants.metadata"],
      filters: { external_id: externalIdFilters },
    }).config({ name: "get-existing-products" });

    const { productsToCreate, productsToUpdate } = transform(
      { products, stores, existingProducts, categories },
      (data) => {
        const toCreate: CreateProductWorkflowInputDTO[] = [];
        const toUpdate: UpsertProductDTO[] = [];

        data.products.forEach((shopifyProduct) => {
          const existing = data.existingProducts.find(
            (p) => p.external_id === shopifyProduct.id.split("/").pop()
          );

          const productData: CreateProductWorkflowInputDTO | UpsertProductDTO =
            {
              title: shopifyProduct.title,
              description: shopifyProduct.description || "",
              options: shopifyProduct.options.map((option) => ({
                title: option.name,
                values: option.values,
              })),
              status:
                shopifyProduct.status === "DRAFT"
                  ? ("draft" as ProductStatus)
                  : ("published" as ProductStatus),
              external_id:
                shopifyProduct.id.split("/").pop() || "External ID not found",
              sales_channels: [{ id: data.stores[0].default_sales_channel_id }],
              images: shopifyProduct.images.map((img) => ({
                url: img.url,
                metadata: { external_id: img.id },
              })),
              metadata: {
                bx_code: getStringFromMetafield(
                  shopifyProduct.metafields,
                  "bx_code"
                ),
                b2box_verified: getBooleanFromMetafield(
                  shopifyProduct.metafields,
                  "verified"
                ),
                verified_video: getStringFromMetafield(
                  shopifyProduct.metafields,
                  "verified_video"
                ),
                product_video: getStringFromMetafield(
                  shopifyProduct.metafields,
                  "product_video"
                ),
              },
              variants: shopifyProduct.variants.map((variant) => ({
                title: variant.title,
                sku: variant.sku || undefined,
                manage_inventory: false,
                prices: data.stores[0].supported_currencies.map(
                  ({ currency_code }) => ({
                    amount: parseFloat(variant.price),
                    currency_code,
                  })
                ),
                material: getStringFromMetafield(
                  variant.metafields,
                  "material"
                ),
                width: getFloatFromMetafield(
                  variant.metafields,
                  "product_width"
                ),
                length: getFloatFromMetafield(
                  variant.metafields,
                  "product_length"
                ),
                height: getFloatFromMetafield(
                  variant.metafields,
                  "product_height"
                ),
                weight: getFloatFromMetafield(
                  variant.metafields,
                  "product_weight"
                ),
                metadata: {
                  pa_code: getStringFromMetafield(
                    variant.metafields,
                    "pa_code"
                  ),
                  has_battery: getBooleanFromMetafield(
                    variant.metafields,
                    "battery"
                  ),
                  is_clothing: getBooleanFromMetafield(
                    variant.metafields,
                    "fabric"
                  ),
                  box: {
                    width: getFloatFromMetafield(
                      variant.metafields,
                      "box_width"
                    ),
                    height: getFloatFromMetafield(
                      variant.metafields,
                      "box_height"
                    ),
                    length: getFloatFromMetafield(
                      variant.metafields,
                      "box_length"
                    ),
                    weight: getFloatFromMetafield(
                      variant.metafields,
                      "box_weight"
                    ),
                  },
                },
                options: Object.fromEntries(
                  variant.selectedOptions.map((so) => [so.name, so.value])
                ),
              })),
              category_ids: shopifyProduct?.collections
                ?.map(
                  (c) =>
                    data.categories?.find(
                      (cat) => cat.metadata.external_id === c.id
                    )?.id
                )
                ?.filter(Boolean),
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
          productsToUpdate: toUpdate,
        };
      }
    );

    createProductsWorkflow.runAsStep({
      input: {
        products: productsToCreate,
      },
    });

    updateProductsWorkflow.runAsStep({
      input: { products: productsToUpdate },
    });

    return new WorkflowResponse({
      success: true,
      message: "Products migrated from Shopify",
    });
  }
);
