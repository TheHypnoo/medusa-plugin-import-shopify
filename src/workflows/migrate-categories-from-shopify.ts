import {
  createWorkflow,
  StepFunction,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  batchLinkProductsToCategoryStep,
  createProductCategoriesWorkflow,
  getProductsStep,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows";
import { CreateProductCategoryDTO } from "@medusajs/framework/types";
import { getShopifyCategoriesStep } from "./steps/get-shopify-categories";

export const migrateCategoriesFromShopifyWorkflowId =
  "migrate-categories-from-shopify";

export const migrateCategoriesFromShopify = createWorkflow(
  {
    name: migrateCategoriesFromShopifyWorkflowId,
    retentionTime: 10000,
    store: true,
  },
  () => {
    const categories = getShopifyCategoriesStep();

    const { data: existingCategories } = useQueryGraphStep({
      entity: "product_category",
      fields: ["id"],
    }).config({ name: "get-existing-categories" });

    const categoriesToCreate = transform(
      { categories, existingCategories },
      (data) => {
        const result: CreateProductCategoryDTO[] = [];
        if (!Array.isArray(data.categories)) {
          return result;
        }
        data.categories.forEach((cat) => {
          const existing = data.existingCategories.find((c) => c.id === cat.id);

          if (!existing) {
            result.push({
              name: cat.title,
              is_active: true,
              metadata: {
                external_id: cat.id,
              },
            });
          }
        });
        return result;
      }
    );

    createProductCategoriesWorkflow
      .runAsStep({
        input: { product_categories: categoriesToCreate },
      })
      .config({ name: "create-product-categories" });

    return new WorkflowResponse({
      success: true,
      message: "Categories migrated from Shopify",
    });
  }
);
