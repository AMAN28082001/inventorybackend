import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Solar Quotation Management System API',
    version: '1.0.0',
    description: 'REST API for Solar Quotation Management System - Chairbord Solar',
    contact: {
      name: 'API Support',
      email: 'api-support@chairbord.com'
    }
  },
  servers: [
    {
      url: `http://api.inventory.chairbordsolar.com`,
      description: 'Live server with domain name'
    },
    {
      url: `http://43.204.133.228:${3050}`,
      description: 'Live server for testing purposes'
    },
    {
      url: `http://localhost:${3050}`,
      description: 'Development server'
    },
    {
      url: `http://localhost:${process.env.PORT || 3000}/api`,
      description: 'Development server'
    },
    {
      url: `${process.env.PROD_URL || 'https://api.chairbord.com'}/api`,
      description: 'Production server'
    },
    {
      url: 'https://api.chairbord.com/v1',
      description: 'Production API (v1)'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      SuccessResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string' },
          data: { type: 'object' }
        }
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'VAL_001' },
              message: { type: 'string' },
              details: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string' },
                    message: { type: 'string' }
                  }
                }
              }
            }
          }
        }
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          totalPages: { type: 'integer' },
          hasNext: { type: 'boolean' },
          hasPrev: { type: 'boolean' }
        }
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'string',
            description: 'Error message'
          },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                message: { type: 'string' }
              }
            }
          }
        }
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          username: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['super-admin', 'super-admin-manager', 'admin', 'agent', 'account'] },
          is_active: { type: 'boolean' },
          created_by_id: { type: 'string', nullable: true },
          created_by_name: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      },
      Product: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          model: { type: 'string' },
          wattage: { type: 'string', nullable: true },
          category: { type: 'string' },
          quantity: { type: 'integer' },
          unit_price: { type: 'number', nullable: true },
          image: { type: 'string', nullable: true },
          created_by: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      },
      LoginRequest: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string' }
        }
      },
      LoginResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              refreshToken: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  username: { type: 'string' },
                  firstName: { type: 'string' },
                  lastName: { type: 'string' },
                  email: { type: 'string' },
                  role: { type: 'string', enum: ['dealer', 'visitor', 'admin'] }
                }
              },
              expiresIn: { type: 'integer' }
            }
          }
        }
      },
      Address: {
        type: 'object',
        required: ['street', 'city', 'state', 'pincode'],
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
          state: { type: 'string' },
          pincode: { type: 'string', pattern: '^\\d{6}$' }
        }
      },
      DealerRegisterRequest: {
        type: 'object',
        required: ['username', 'password', 'firstName', 'lastName', 'email', 'mobile', 'gender', 'dateOfBirth', 'fatherName', 'fatherContact', 'governmentIdType', 'governmentIdNumber', 'address'],
        properties: {
          username: { type: 'string', minLength: 3, pattern: '^[a-zA-Z0-9_]+$' },
          password: { type: 'string', minLength: 8 },
          firstName: { type: 'string', minLength: 2 },
          lastName: { type: 'string', minLength: 2 },
          email: { type: 'string', format: 'email' },
          mobile: { type: 'string', pattern: '^\\d{10}$' },
          gender: { type: 'string', enum: ['Male', 'Female', 'Other'] },
          dateOfBirth: { type: 'string', format: 'date' },
          fatherName: { type: 'string' },
          fatherContact: { type: 'string', pattern: '^\\d{10}$' },
          governmentIdType: { type: 'string', enum: ['Aadhaar Card', 'PAN Card', 'Voter ID', 'Driving License', 'Passport'] },
          governmentIdNumber: { type: 'string' },
          governmentIdImage: { type: 'string' },
          address: { $ref: '#/components/schemas/Address' }
        }
      },
      QuotationProducts: {
        type: 'object',
        required: ['systemType'],
        properties: {
          systemType: { type: 'string', enum: ['on-grid', 'off-grid', 'hybrid', 'dcr', 'non-dcr', 'both', 'customize'] },
          panelBrand: { type: 'string' },
          panelSize: { type: 'string' },
          panelQuantity: { type: 'integer' },
          panelPrice: { type: 'number' },
          dcrPanelBrand: { type: 'string' },
          dcrPanelSize: { type: 'string' },
          dcrPanelQuantity: { type: 'integer' },
          nonDcrPanelBrand: { type: 'string' },
          nonDcrPanelSize: { type: 'string' },
          nonDcrPanelQuantity: { type: 'integer' },
          inverterType: { type: 'string' },
          inverterBrand: { type: 'string' },
          inverterSize: { type: 'string' },
          inverterPrice: { type: 'number' },
          structureType: { type: 'string' },
          structureSize: { type: 'string' },
          structurePrice: { type: 'number' },
          meterBrand: { type: 'string' },
          meterPrice: { type: 'number' },
          acCableBrand: { type: 'string' },
          acCableSize: { type: 'string' },
          acCablePrice: { type: 'number' },
          dcCableBrand: { type: 'string' },
          dcCableSize: { type: 'string' },
          dcCablePrice: { type: 'number' },
          acdb: { type: 'string' },
          acdbPrice: { type: 'number' },
          dcdb: { type: 'string' },
          dcdbPrice: { type: 'number' },
          hybridInverter: { type: 'string' },
          batteryCapacity: { type: 'string' },
          batteryPrice: { type: 'number' },
          centralSubsidy: { type: 'number', default: 0 },
          stateSubsidy: { type: 'number', default: 0 },
          pdfCommercialSet: {
            type: 'boolean',
            default: false,
            description: 'PDF-only: commercial set — hide subsidy lines on proposal PDF'
          },
          pdf_commercial_set: {
            type: 'boolean',
            default: false,
            description: 'Snake_case mirror of pdfCommercialSet'
          },
          pdfPanelRangeKey: {
            type: 'string',
            nullable: true,
            description:
              'PDF-only panel spec key (not used in pricing). Includes tata_530_570 (Tata DCR) and premier_energy_600_610 (Crompton DCR set).',
            enum: [
              'waaree_540_560_bifacial',
              'waaree_580_700_bifacial_topcon',
              'waaree_580_630',
              'adani_540_580_bifacial',
              'adani_610_625_bifacial_topcon',
              'adani_600_630',
              'premier_600_625_bifacial_topcon',
              'tata_530_570',
              'ina_500_600_bifacial',
              'renew_energy_600_630',
              'premier_energy_600_610'
            ]
          },
          pdfDcrPanelRangeKey: { type: 'string', nullable: true },
          pdfNonDcrPanelRangeKey: { type: 'string', nullable: true },
          customPanels: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                brand: { type: 'string' },
                size: { type: 'string' },
                quantity: { type: 'integer' },
                type: { type: 'string', enum: ['dcr', 'non-dcr'] },
                price: { type: 'number' }
              }
            }
          }
        }
      },
      QuotationPricing: {
        type: 'object',
        properties: {
          panelPrice: { type: 'number' },
          inverterPrice: { type: 'number' },
          structurePrice: { type: 'number' },
          meterPrice: { type: 'number' },
          cablePrice: { type: 'number' },
          acdbDcdbPrice: { type: 'number' },
          subtotal: { type: 'number' },
          centralSubsidy: { type: 'number' },
          stateSubsidy: { type: 'number' },
          totalAmount: { type: 'number' },
          discountAmount: { type: 'number' },
          finalAmount: { type: 'number' }
        }
      },
      Visitor: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          username: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          mobile: { type: 'string' },
          employeeId: { type: 'string' },
          isActive: { type: 'boolean' },
          visitCount: { type: 'integer' },
          createdBy: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        }
      },
      Dealer: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          username: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string' },
          mobile: { type: 'string' },
          company: { type: 'string' },
          role: { type: 'string', enum: ['dealer'] },
          isActive: { type: 'boolean' },
          emailVerified: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        }
      },
      DealerStatistics: {
        type: 'object',
        properties: {
          totalQuotations: { type: 'integer' },
          totalCustomers: { type: 'integer' },
          totalRevenue: { type: 'number' },
          thisMonth: {
            type: 'object',
            properties: {
              quotations: { type: 'integer' },
              revenue: { type: 'number' }
            }
          },
          statusBreakdown: {
            type: 'object',
            properties: {
              pending: { type: 'integer' },
              approved: { type: 'integer' },
              rejected: { type: 'integer' },
              completed: { type: 'integer' }
            }
          }
        }
      },
      Customer: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          mobile: { type: 'string' },
          email: { type: 'string' },
          address: { $ref: '#/components/schemas/Address' },
          dealerId: { type: 'string' },
          quotations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                systemType: { type: 'string' },
                finalAmount: { type: 'number' },
                status: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' }
              }
            }
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        }
      },
      Visit: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          quotationId: { type: 'string' },
          dealerId: { type: 'string' },
          visitDate: { type: 'string', format: 'date' },
          visitTime: { type: 'string', format: 'time' },
          location: { type: 'string' },
          locationLink: { type: 'string', format: 'uri' },
          notes: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'approved', 'completed', 'incomplete', 'rejected', 'rescheduled'] },
          length: { type: 'number', nullable: true },
          width: { type: 'number', nullable: true },
          height: { type: 'number', nullable: true },
          images: { type: 'array', items: { type: 'string' }, nullable: true },
          rejectionReason: { type: 'string', nullable: true },
          visitors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                visitorId: { type: 'string' },
                visitorName: { type: 'string' }
              }
            }
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        }
      },
      Quotation: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          dealerId: { type: 'string' },
          customerId: { type: 'string' },
          customer: { $ref: '#/components/schemas/Customer' },
          systemType: { type: 'string', enum: ['on-grid', 'off-grid', 'hybrid', 'dcr', 'non-dcr', 'both', 'customize'] },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'completed'] },
          discount: { type: 'number' },
          products: { $ref: '#/components/schemas/QuotationProducts' },
          pricing: { $ref: '#/components/schemas/QuotationPricing' },
          finalAmount: { type: 'number' },
          validUntil: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' }
        }
      },
      ProductCatalog: {
        type: 'object',
        required: ['panels', 'inverters', 'structures', 'meters', 'cables', 'acdb', 'dcdb'],
        properties: {
          panels: {
            type: 'object',
            required: ['brands', 'sizes'],
            properties: {
              brands: {
                type: 'array',
                items: { type: 'string' },
                example: ['Adani', 'Tata', 'Waaree', 'Vikram Solar', 'RenewSys']
              },
              sizes: {
                type: 'array',
                items: { type: 'string' },
                example: ['440W', '445W', '540W', '545W', '550W', '555W']
              }
            }
          },
          inverters: {
            type: 'object',
            required: ['types', 'brands', 'sizes'],
            properties: {
              types: {
                type: 'array',
                items: { type: 'string' },
                example: ['String Inverter', 'Micro Inverter', 'Hybrid Inverter']
              },
              brands: {
                type: 'array',
                items: { type: 'string' },
                example: ['Growatt', 'Solis', 'Fronius', 'Havells', 'Polycab', 'Delta']
              },
              sizes: {
                type: 'array',
                items: { type: 'string' },
                example: ['3kW', '5kW', '6kW', '8kW', '10kW', '15kW', '20kW', '25kW']
              }
            }
          },
          structures: {
            type: 'object',
            required: ['types', 'sizes'],
            properties: {
              types: {
                type: 'array',
                items: { type: 'string' },
                example: ['GI Structure', 'Aluminum Structure', 'MS Structure']
              },
              sizes: {
                type: 'array',
                items: { type: 'string' },
                example: ['1kW', '2kW', '3kW', '5kW', '10kW', '15kW', '20kW']
              }
            }
          },
          meters: {
            type: 'object',
            required: ['brands'],
            properties: {
              brands: {
                type: 'array',
                items: { type: 'string' },
                example: ['L&T', 'HPL', 'Havells', 'Genus', 'Secure']
              }
            }
          },
          cables: {
            type: 'object',
            required: ['brands', 'sizes'],
            properties: {
              brands: {
                type: 'array',
                items: { type: 'string' },
                example: ['Polycab', 'Havells', 'KEI', 'Finolex', 'RR Kabel']
              },
              sizes: {
                type: 'array',
                items: { type: 'string' },
                example: ['4 sq mm', '6 sq mm', '10 sq mm', '16 sq mm', '25 sq mm']
              }
            }
          },
          acdb: {
            type: 'object',
            required: ['options'],
            properties: {
              options: {
                type: 'array',
                items: { type: 'string' },
                example: ['1-String', '2-String', '3-String', '4-String']
              }
            }
          },
          dcdb: {
            type: 'object',
            required: ['options'],
            properties: {
              options: {
                type: 'array',
                items: { type: 'string' },
                example: ['1-String', '2-String', '3-String', '4-String', '5-String']
              }
            }
          }
        }
      },
      ProductCatalogResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { $ref: '#/components/schemas/ProductCatalog' }
        }
      },
      ProductCatalogUpdateResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Product catalog updated successfully' },
          data: { $ref: '#/components/schemas/ProductCatalog' }
        }
      }
    }
  },
  tags: [
    { name: 'Auth', description: 'Authentication endpoints' },
    { name: 'Users', description: 'User management endpoints' },
    { name: 'Products', description: 'Product management endpoints' },
    { name: 'Categories', description: 'Category endpoints' },
    { name: 'Admin Inventory', description: 'Admin inventory management endpoints' },
    { name: 'Stock Requests', description: 'Stock request endpoints' },
    { name: 'Sales', description: 'Sales management endpoints' },
    { name: 'Inventory Transactions', description: 'Inventory transaction endpoints' },
    { name: 'Stock Returns', description: 'Stock return endpoints' },
    { name: 'Quotations', description: 'Quotation management endpoints' },
    { name: 'Dealers', description: 'Dealer management endpoints' },
    { name: 'Customers', description: 'Customer management endpoints' },
    { name: 'Visits', description: 'Visit management endpoints' },
    { name: 'Visitors', description: 'Visitor management endpoints' },
    { name: 'Admin', description: 'Admin management endpoints (Quotation System)' },
    { name: 'Config', description: 'System configuration endpoints' }
  ]
};

const apiGlobs = [
  path.resolve(__dirname, '../routes/*.ts'),
  path.resolve(__dirname, '../controllers/*.ts'),
  path.resolve(__dirname, '../routes/*.js'),
  path.resolve(__dirname, '../controllers/*.js')
];

const options = {
  definition: swaggerDefinition,
  apis: apiGlobs // Path to the API files (supports TS in dev and transpiled JS in Docker)
};

export const swaggerSpec = swaggerJsdoc(options);

