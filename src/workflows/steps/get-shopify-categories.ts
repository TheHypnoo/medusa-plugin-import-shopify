import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import ShopifyService from "../../modules/shopify/service";
import { SHOPIFY_MODULE } from "../../modules/shopify";

export const getShopifyCategoriesStep = createStep(
  {
    name: "get-shopify-categories",
    async: true,
  },
  async ({}, { container }) => {
    const shopifyService: ShopifyService = container.resolve(SHOPIFY_MODULE);
    const categories = await shopifyService.getCategories();
    return new StepResponse(categories);
  }
);
