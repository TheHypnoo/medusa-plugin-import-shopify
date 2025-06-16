import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { CreateProductWorkflowInputDTO, UpsertProductDTO } from "@medusajs/framework/types"
import { createProductsWorkflow, updateProductsWorkflow, useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { getShopifyProductsStep } from "./steps/get-shopify-products"

export const migrateProductsFromShopifyWorkflowId = "migrate-products-from-shopify"

export const migrateProductsFromShopify = createWorkflow(
  {
    name: migrateProductsFromShopifyWorkflowId,
    retentionTime: 10000,
    store: true,
  },
  () => {
    const products = getShopifyProductsStep()

    const { data: stores } = useQueryGraphStep({
      entity: "store",
      fields: ["supported_currencies.*", "default_sales_channel_id"],
      pagination: { take: 1, skip: 0 },
    })


    const externalIdFilters = transform({ products }, (data) => {
      return data.products.map((p) => p.id)
    })

    const { data: existingProducts } = useQueryGraphStep({
      entity: "product",
      fields: ["id", "external_id", "variants.id", "variants.metadata"],
      filters: { external_id: externalIdFilters },
    }).config({ name: "get-existing-products" })

    const { productsToCreate, productsToUpdate } = transform(
      { products, stores, existingProducts },
      (data) => {
        const toCreate = new Map<string, CreateProductWorkflowInputDTO>()
        const toUpdate = new Map<string, UpsertProductDTO>()

        data.products.forEach((shopifyProduct) => {
          const existing = data.existingProducts.find((p) => p.external_id === shopifyProduct.id)
          const productData: CreateProductWorkflowInputDTO | UpsertProductDTO = {
            title: shopifyProduct.title,
            description: shopifyProduct.descriptionHtml || undefined,
            status: "published",
            handle: `${shopifyProduct.title.toLowerCase().replace(/\s+/g, "-")}-${shopifyProduct.id}`,
            external_id: shopifyProduct.id,
            sales_channels: [{ id: data.stores[0].default_sales_channel_id }],
            options: shopifyProduct.options.map((o) => ({ title: o.name, values: o.values })),
            images: shopifyProduct.images.map((img) => ({
              url: img.url,
              metadata: { external_id: img.id },
            })),
            variants: shopifyProduct.variants.map((variant) => {
              const existingVariant = existing?.variants.find(
                (v) => v.metadata?.external_id === variant.id
              )
              return {
                id: existingVariant?.id,
                title: variant.title,
                sku: variant.sku || undefined,
                options: Object.fromEntries(variant.selectedOptions.map((so) => [so.name, so.value])),
                prices: data.stores[0].supported_currencies.map(({ currency_code }) => ({
                  amount: parseFloat(variant.price),
                  currency_code,
                })),
                inventory_quantity: variant.inventoryQuantity ?? 0,
                metadata: { external_id: variant.id },
              }
            }),
          }

          if (existing) {
            productData.id = existing.id
            toUpdate.set(existing.id, productData as UpsertProductDTO)
          } else {
            toCreate.set(shopifyProduct.id, productData as CreateProductWorkflowInputDTO)
          }
        })

        return {
          productsToCreate: Array.from(toCreate.values()),
          productsToUpdate: Array.from(toUpdate.values()),
        }
      }
    )

    createProductsWorkflow.runAsStep({
      input: { products: productsToCreate },
    })

    updateProductsWorkflow.runAsStep({
      input: { products: productsToUpdate },
    })

    return new WorkflowResponse({ count: products.length })
  }
)
