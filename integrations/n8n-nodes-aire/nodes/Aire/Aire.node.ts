import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IHttpRequestMethods,
  IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * AIRE node — the single building block for AIRE agent flows in n8n.
 *
 * Every operation calls the AIRE bridge API, authenticating with the per-tenant
 * bridge token. Base URL and token default to the values injected by the AIRE
 * WhatsApp trigger payload (`callbackBaseUrl`, `bridgeToken`), so ONE flow serves
 * every tenant — data scoping, tool gating and the tenant's own LLM key are all
 * enforced server-side by AIRE.
 */
export class Aire implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'AIRE',
    name: 'aire',
    icon: 'fa:robot',
    group: ['transform'],
    version: 1,
    subtitle: '={{ $parameter["operation"] }}',
    description: 'Talk to the AIRE bridge: scoped context, LLM, tools, WhatsApp send',
    defaults: { name: 'AIRE' },
    inputs: ['main'],
    outputs: ['main'],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Get Customer Context', value: 'getContext', description: 'Scoped customer data + public info + tenant persona', action: 'Get customer context' },
          { name: 'LLM Reply', value: 'llm', description: 'Chat completion via the tenant provider + their key', action: 'Generate an LLM reply' },
          { name: 'Run Tool', value: 'runTool', description: 'Execute a full-business AIRE tool — back-office AUTOMATION flows only (toggle/approval gated)', action: 'Run an AIRE tool' },
          { name: 'Run Customer Tool', value: 'runCustomerTool', description: 'Execute a CUSTOMER-scoped tool (my data, prices, booking) bound to the sender — use this in conversation flows', action: 'Run a customer tool' },
          { name: 'Send WhatsApp', value: 'sendWhatsapp', description: 'Send a reply and log it to the Conversation Log', action: 'Send a WhatsApp message' },
          { name: 'Escalate to Human', value: 'escalate', description: 'Mark the conversation escalated, ack the customer, notify the tenant', action: 'Escalate to a human' },
        ],
        default: 'getContext',
      },
      {
        displayName: 'AIRE Base URL',
        name: 'baseUrl',
        type: 'string',
        default: '={{ $json.callbackBaseUrl }}',
        description: 'Base URL of the AIRE backend (defaults to the value injected by the AIRE trigger)',
      },
      {
        displayName: 'Bridge Token',
        name: 'bridgeToken',
        type: 'string',
        typeOptions: { password: true },
        default: '={{ $json.bridgeToken }}',
        description: "The tenant's bridge token (defaults to the value injected by the AIRE trigger)",
      },

      // getContext + escalate + runCustomerTool
      {
        displayName: 'From Phone',
        name: 'fromPhone',
        type: 'string',
        default: '={{ $json.message.from }}',
        displayOptions: { show: { operation: ['getContext', 'escalate', 'runCustomerTool'] } },
      },

      // runCustomerTool
      {
        displayName: 'Customer Tool',
        name: 'customerTool',
        type: 'options',
        options: [
          { name: 'Get My Summary', value: 'get_my_summary' },
          { name: 'Get Service Prices', value: 'get_service_prices' },
          { name: 'Get Membership Plans', value: 'get_membership_plans' },
          { name: 'Get Promotions', value: 'get_promotions' },
          { name: 'Create Booking (proposes; customer confirms on WhatsApp)', value: 'create_booking' },
          { name: 'Escalate to Human', value: 'escalate_to_human' },
        ],
        default: 'get_my_summary',
        displayOptions: { show: { operation: ['runCustomerTool'] } },
      },
      {
        displayName: 'Persona Role',
        name: 'role',
        type: 'options',
        options: [
          { name: 'Personal Assistant', value: 'personal_assistant' },
          { name: 'Customer Service', value: 'customer_service' },
          { name: 'Sales', value: 'sales' },
          { name: 'Supervisor', value: 'supervisor' },
        ],
        default: 'personal_assistant',
        description: 'Which persona this runs as — gates the allowed tools server-side',
        displayOptions: { show: { operation: ['runCustomerTool'] } },
      },
      {
        displayName: 'Reason',
        name: 'reason',
        type: 'string',
        default: 'Escalated by agent flow',
        description: 'Why the conversation is being handed to a human (sent to the tenant)',
        displayOptions: { show: { operation: ['escalate'] } },
      },

      // llm
      {
        displayName: 'Messages (JSON)',
        name: 'messages',
        type: 'json',
        default: '=[]',
        description: 'Array of { role, content } chat messages',
        displayOptions: { show: { operation: ['llm'] } },
      },
      {
        displayName: 'Temperature',
        name: 'temperature',
        type: 'number',
        default: 0.4,
        displayOptions: { show: { operation: ['llm'] } },
      },
      {
        displayName: 'Max Tokens',
        name: 'maxTokens',
        type: 'number',
        default: 500,
        displayOptions: { show: { operation: ['llm'] } },
      },

      // runTool
      {
        displayName: 'Tool Name',
        name: 'toolName',
        type: 'string',
        default: '',
        placeholder: 'find_customer',
        displayOptions: { show: { operation: ['runTool'] } },
      },
      {
        displayName: 'Parameters (JSON)',
        name: 'parameters',
        type: 'json',
        default: '={}',
        displayOptions: { show: { operation: ['runTool', 'runCustomerTool'] } },
      },

      // sendWhatsapp
      {
        displayName: 'To',
        name: 'to',
        type: 'string',
        default: '={{ $json.message.from }}',
        displayOptions: { show: { operation: ['sendWhatsapp'] } },
      },
      {
        displayName: 'Text',
        name: 'text',
        type: 'string',
        typeOptions: { rows: 3 },
        default: '',
        displayOptions: { show: { operation: ['sendWhatsapp'] } },
      },
      {
        displayName: 'Persona',
        name: 'persona',
        type: 'string',
        default: '',
        placeholder: 'Sales',
        description: 'Optional: the agent/persona name to attribute this reply to in the Conversation Log',
        displayOptions: { show: { operation: ['sendWhatsapp'] } },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const operation = this.getNodeParameter('operation', i) as string;
      const baseUrl = String(this.getNodeParameter('baseUrl', i)).replace(/\/+$/, '');
      const bridgeToken = String(this.getNodeParameter('bridgeToken', i));

      if (!baseUrl) throw new NodeOperationError(this.getNode(), 'AIRE Base URL is empty', { itemIndex: i });
      if (!bridgeToken) throw new NodeOperationError(this.getNode(), 'Bridge Token is empty', { itemIndex: i });

      let path = '';
      let body: Record<string, unknown> = {};

      if (operation === 'getContext') {
        path = '/api/bridge/context';
        body = { fromPhone: this.getNodeParameter('fromPhone', i) };
      } else if (operation === 'llm') {
        path = '/api/bridge/llm';
        body = {
          messages: parseJson(this.getNodeParameter('messages', i)),
          temperature: this.getNodeParameter('temperature', i),
          maxTokens: this.getNodeParameter('maxTokens', i),
        };
      } else if (operation === 'runTool') {
        path = '/api/bridge/tool';
        body = {
          toolName: this.getNodeParameter('toolName', i),
          parameters: parseJson(this.getNodeParameter('parameters', i)),
        };
      } else if (operation === 'runCustomerTool') {
        path = '/api/bridge/whatsapp/tool';
        body = {
          fromPhone: this.getNodeParameter('fromPhone', i),
          tool: this.getNodeParameter('customerTool', i),
          role: this.getNodeParameter('role', i),
          parameters: parseJson(this.getNodeParameter('parameters', i)),
        };
      } else if (operation === 'sendWhatsapp') {
        path = '/api/bridge/whatsapp/send';
        const persona = String(this.getNodeParameter('persona', i, '') ?? '').trim();
        body = { to: this.getNodeParameter('to', i), text: this.getNodeParameter('text', i), ...(persona ? { persona } : {}) };
      } else if (operation === 'escalate') {
        path = '/api/bridge/escalate';
        body = { fromPhone: this.getNodeParameter('fromPhone', i), reason: this.getNodeParameter('reason', i) };
      } else {
        throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
      }

      const response = await this.helpers.httpRequest({
        method: 'POST' as IHttpRequestMethods,
        url: `${baseUrl}${path}`,
        headers: { 'Content-Type': 'application/json', 'X-Aire-Bridge-Token': bridgeToken },
        body,
        json: true,
      });

      out.push({ json: (response ?? {}) as IDataObject, pairedItem: { item: i } });
    }

    return [out];
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}
