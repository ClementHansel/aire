import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { JWTPayload } from '@aire/shared';
import { CurrentUser } from '../../common/decorators';
import { AIService, AIResponse, Anomaly } from './ai.service';

/**
 * Request body for the AI query endpoint.
 */
interface QueryInsightsBody {
  question: string;
}

/**
 * AIController exposes the Hermes AI copilot endpoints.
 *
 * Endpoints:
 * - POST /api/ai/query — Ask a natural language business question
 * - GET /api/ai/anomalies — Get detected anomalies for a date range
 *
 * Requirements: 32.1, 32.2
 */
@Controller('api/ai')
export class AIController {
  constructor(private readonly aiService: AIService) {}

  /**
   * POST /api/ai/query
   *
   * Accepts a natural language question about business data and returns
   * an AI-generated response with insights.
   *
   * Requirement: 32.1
   */
  @Post('query')
  async queryInsights(
    @CurrentUser() user: JWTPayload,
    @Body() body: QueryInsightsBody,
  ): Promise<AIResponse> {
    if (!body.question || body.question.trim().length === 0) {
      throw new BadRequestException('Question is required and cannot be empty.');
    }

    return this.aiService.queryInsights(body.question.trim(), user.tenant_id);
  }

  /**
   * GET /api/ai/anomalies
   *
   * Detects and returns anomalies in business data for the specified date range.
   * If no date range is provided, defaults to the last 7 days.
   *
   * Requirement: 32.2
   */
  @Get('anomalies')
  async getAnomalies(
    @CurrentUser() user: JWTPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<Anomaly[]> {
    // Default to last 7 days if no range provided
    const toDate =
      to && !isNaN(Date.parse(to))
        ? to
        : new Date().toISOString().split('T')[0];

    const fromDate =
      from && !isNaN(Date.parse(from))
        ? from
        : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0];

    return this.aiService.detectAnomalies(user.tenant_id, {
      from: fromDate!,
      to: toDate!,
    });
  }
}
