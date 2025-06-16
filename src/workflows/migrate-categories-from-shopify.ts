import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  createProductCategoriesWorkflow,
  updateProductsWorkflow,
  useQueryGraphStep,
} from "@medusajs/medusa/core-flows";
import {
  CreateProductCategoryDTO,
  UpdateProductDTO,
} from "@medusajs/framework/types";
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

    const handleFilters = transform({ categories }, (data) => {
      if (!Array.isArray(data.categories)) {
        return [];
      }
      return data.categories.map((c) => c.handle);
    });

    const { data: existingCategories } = useQueryGraphStep({
      entity: "product_category",
      fields: ["id", "handle", "metadata"],
      filters: { handle: handleFilters },
    }).config({ name: "get-existing-categories" });

    const categoriesToCreate = transform(
      { categories, existingCategories },
      (data) => {
        const result: CreateProductCategoryDTO[] = [];
        if (!Array.isArray(data.categories)) {
          return result;
        }
        data.categories.forEach((cat) => {
          const existing = data.existingCategories.find(
            (c) => c.handle === cat.handle
          );
          if (!existing) {
            result.push({
              name: cat.title,
              handle: cat.handle,
              is_active: true,
              metadata: { external_id: cat.id },
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

    const { data: allCategories } = useQueryGraphStep({
      entity: "product_category",
      fields: ["id", "metadata"],
      filters: {
        metadata: {
          key: "external_id",
          value: transform({ categories }, (data) => {
            if (!Array.isArray(data.categories)) {
              return [];
            }
            return data.categories.map((c) => c.id);
          }),
        },
      },
      pagination: {
        take: 10,
        skip: 0,
      },
    }).config({ name: "get-all-categories" });

    const productExternalIds = transform({ categories }, (data) => {
      const set = new Set<string>();
      if (!Array.isArray(data.categories)) {
        return Array.from(set);
      }
      data.categories.forEach((c) => c.productIds.forEach((id) => set.add(id)));
      return Array.from(set);
    });

    const { data: products } = useQueryGraphStep({
      entity: "product",
      fields: ["id", "external_id"],
      filters: { external_id: productExternalIds },
    }).config({ name: "get-products" });

    const updates = transform(
      { categories, allCategories, products },
      (data) => {
        const productMap = new Map<string, UpdateProductDTO>();
        const categoryMap = new Map<string, string>();
        data.allCategories.forEach((c) => {
          if (c.metadata?.external_id) {
            categoryMap.set(c.metadata.external_id, c.id);
          }
        });
        if (!Array.isArray(data.categories)) {
          return Array.from(productMap.values());
        }
        data.categories.forEach((cat) => {
          const categoryId = categoryMap.get(cat.id);
          if (!categoryId) return;
          cat.productIds.forEach((pid) => {
            const prod = data.products.find((p) => p.external_id === pid);
            if (!prod) return;
            const existing = productMap.get(prod.id) || {
              id: prod.id,
              category_ids: [],
            };
            existing.category_ids = Array.from(
              new Set([...existing.category_ids!, categoryId])
            );
            productMap.set(prod.id, existing);
          });
        });
        return Array.from(productMap.values());
      }
    );

    updateProductsWorkflow.runAsStep({ input: { products: updates } });

    return new WorkflowResponse({
      count: transform({ categories }, (data) => {
        if (!Array.isArray(data.categories)) {
          return 0;
        }
        return data.categories.length;
      }),
    });
  }
);
