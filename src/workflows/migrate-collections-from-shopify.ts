import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { CreateProductCollectionDTO } from "@medusajs/framework/types"
import { createCollectionsWorkflow, useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { getShopifyCollectionsStep } from "./steps/get-shopify-collections"

export const migrateCollectionsFromShopifyWorkflowId = "migrate-collections-from-shopify"

export const migrateCollectionsFromShopify = createWorkflow(
  {
    name: migrateCollectionsFromShopifyWorkflowId,
    retentionTime: 10000,
    store: true,
  },
  () => {
    const collections = getShopifyCollectionsStep()

    const handleFilters = transform({ collections }, (data) => {
      return data.collections.map((c) => c.handle)
    })

    const { data: existingCollections } = useQueryGraphStep({
      entity: "product_collection",
      fields: ["id", "handle"],
      filters: { handle: handleFilters },
    }).config({ name: "get-existing-collections" })

    const collectionsToCreate = transform(
      { collections, existingCollections },
      (data) => {
        const result: CreateProductCollectionDTO[] = []
        data.collections.forEach((coll) => {
          const existing = data.existingCollections.find((c) => c.handle === coll.handle)
          if (!existing) {
            result.push({
              title: coll.title,
              handle: coll.handle,
              metadata: { external_id: coll.id },
            })
          }
        })
        return result
      }
    )

    createCollectionsWorkflow.runAsStep({
      input: { collections: collectionsToCreate },
    })

    return new WorkflowResponse({ count: collections.length })
  }
)
