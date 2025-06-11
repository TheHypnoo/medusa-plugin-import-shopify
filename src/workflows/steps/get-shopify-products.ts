import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import ShopifyService from "../../modules/shopify/service"
import { SHOPIFY_MODULE } from "../../modules/shopify"

export const getShopifyProductsStep = createStep({
  name: "get-shopify-products",
  async: true,
}, async ({}, { container }) => {
  const shopifyService: ShopifyService = container.resolve(SHOPIFY_MODULE)
  const products = await shopifyService.getProducts()
  return new StepResponse(products)
})
