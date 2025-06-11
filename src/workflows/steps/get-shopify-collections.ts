import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import ShopifyService from "../../modules/shopify/service"
import { SHOPIFY_MODULE } from "../../modules/shopify"

export const getShopifyCollectionsStep = createStep({
  name: "get-shopify-collections",
  async: true,
}, async ({}, { container }) => {
  const shopifyService: ShopifyService = container.resolve(SHOPIFY_MODULE)
  const collections = await shopifyService.getCollections()
  return new StepResponse(collections)
})
