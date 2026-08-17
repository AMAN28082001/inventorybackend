import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

interface QuotationProductAttributes {
  id: string;
  quotationId: string;
  systemType: string;
  phase?: string | null;

  // Panel Configuration
  panelBrand?: string | null;
  panelSize?: string | null;
  panelQuantity?: number | null;
  panelPrice?: number | null;

  // DCR/Non-DCR Configuration
  dcrPanelBrand?: string | null;
  dcrPanelSize?: string | null;
  dcrPanelQuantity?: number | null;
  nonDcrPanelBrand?: string | null;
  nonDcrPanelSize?: string | null;
  nonDcrPanelQuantity?: number | null;

  // Inverter Configuration
  inverterType?: string | null;
  inverterBrand?: string | null;
  inverterSize?: string | null;
  inverterPrice?: number | null;

  // Structure & Mounting
  structureType?: string | null;
  structureSize?: string | null;
  structurePrice?: number | null;

  // Electrical Components
  meterBrand?: string | null;
  meterPrice?: number | null;
  acCableBrand?: string | null;
  acCableSize?: string | null;
  acCablePrice?: number | null;
  dcCableBrand?: string | null;
  dcCableSize?: string | null;
  dcCablePrice?: number | null;
  acdb?: string | null;
  acdbPrice?: number | null;
  dcdb?: string | null;
  dcdbPrice?: number | null;

  /** Earthing wire: "As per the set" | "2mm" | "4mm" | "6mm" | custom text */
  earthingWireSize?: string | null;
  /** Earthing brand: "As per the set" | "JMP" | "Polycab" | … | custom */
  earthingWireBrand?: string | null;

  // Battery (for hybrid/off-grid)
  hybridInverter?: string | null;
  batteryCapacity?: string | null;
  batteryPrice?: number | null;

  // Subsidies
  centralSubsidy: number;
  stateSubsidy: number;

  /** PDF display only — not used for pricing/catalog validation */
  pdfUsePanelSizeRange?: boolean;
  pdfUseInverterBrandOptions?: boolean;
  pdfCommercialSet?: boolean;
  pdfPanelRangeKey?: string | null;
  pdfDcrPanelRangeKey?: string | null;
  pdfNonDcrPanelRangeKey?: string | null;

  /** DCR pricing matrix column (e.g. INA) — not catalog panelBrand alias */
  panelType?: string | null;
  inaDcrPackage?: boolean;

  // Totals
  subtotal: number;        // Set price (complete package price)
  totalAmount: number;      // Amount after discount (Subtotal - Subsidy - Discount)
  finalAmount?: number | null;     // Final amount (Subtotal - Subsidy, discount NOT applied)
}

interface QuotationProductCreationAttributes extends Optional<QuotationProductAttributes, 'id' | 'phase' | 'panelBrand' | 'panelSize' | 'panelQuantity' | 'panelPrice' | 'dcrPanelBrand' | 'dcrPanelSize' | 'dcrPanelQuantity' | 'nonDcrPanelBrand' | 'nonDcrPanelSize' | 'nonDcrPanelQuantity' | 'inverterType' | 'inverterBrand' | 'inverterSize' | 'inverterPrice' | 'structureType' | 'structureSize' | 'structurePrice' | 'meterBrand' | 'meterPrice' | 'acCableBrand' | 'acCableSize' | 'acCablePrice' | 'dcCableBrand' | 'dcCableSize' | 'dcCablePrice' | 'acdb' | 'acdbPrice' | 'dcdb' | 'dcdbPrice' | 'earthingWireSize' | 'earthingWireBrand' | 'hybridInverter' | 'batteryCapacity' | 'batteryPrice' | 'centralSubsidy' | 'stateSubsidy' | 'pdfUsePanelSizeRange' | 'pdfUseInverterBrandOptions' | 'pdfCommercialSet' | 'pdfPanelRangeKey' | 'pdfDcrPanelRangeKey' | 'pdfNonDcrPanelRangeKey' | 'panelType' | 'inaDcrPackage' | 'finalAmount'> { }

class QuotationProduct extends Model<QuotationProductAttributes, QuotationProductCreationAttributes> implements QuotationProductAttributes {
  public id!: string;
  public quotationId!: string;
  public systemType!: string;
  public phase!: string | null;
  public panelBrand!: string | null;
  public panelSize!: string | null;
  public panelQuantity!: number | null;
  public panelPrice!: number | null;
  public dcrPanelBrand!: string | null;
  public dcrPanelSize!: string | null;
  public dcrPanelQuantity!: number | null;
  public nonDcrPanelBrand!: string | null;
  public nonDcrPanelSize!: string | null;
  public nonDcrPanelQuantity!: number | null;
  public inverterType!: string | null;
  public inverterBrand!: string | null;
  public inverterSize!: string | null;
  public inverterPrice!: number | null;
  public structureType!: string | null;
  public structureSize!: string | null;
  public structurePrice!: number | null;
  public meterBrand!: string | null;
  public meterPrice!: number | null;
  public acCableBrand!: string | null;
  public acCableSize!: string | null;
  public acCablePrice!: number | null;
  public dcCableBrand!: string | null;
  public dcCableSize!: string | null;
  public dcCablePrice!: number | null;
  public acdb!: string | null;
  public acdbPrice!: number | null;
  public dcdb!: string | null;
  public dcdbPrice!: number | null;
  public earthingWireSize!: string | null;
  public earthingWireBrand!: string | null;
  public hybridInverter!: string | null;
  public batteryCapacity!: string | null;
  public batteryPrice!: number | null;
  public centralSubsidy!: number;
  public stateSubsidy!: number;
  public pdfUsePanelSizeRange!: boolean;
  public pdfUseInverterBrandOptions!: boolean;
  public pdfCommercialSet!: boolean;
  public pdfPanelRangeKey!: string | null;
  public pdfDcrPanelRangeKey!: string | null;
  public pdfNonDcrPanelRangeKey!: string | null;
  public panelType!: string | null;
  public inaDcrPackage!: boolean;
  public subtotal!: number;        // Set price (complete package price)
  public totalAmount!: number;      // Amount after discount (Subtotal - Subsidy - Discount)
  public finalAmount!: number | null | undefined; // Final amount (Subtotal - Subsidy, discount NOT applied)
}

QuotationProduct.init(
  {
    id: {
      type: DataTypes.STRING(50),
      primaryKey: true
    },
    quotationId: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    systemType: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    phase: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    panelBrand: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    panelSize: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    panelQuantity: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    panelPrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    dcrPanelBrand: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    dcrPanelSize: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    dcrPanelQuantity: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    nonDcrPanelBrand: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    nonDcrPanelSize: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    nonDcrPanelQuantity: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    inverterType: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    inverterBrand: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    inverterSize: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    inverterPrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    structureType: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    structureSize: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    structurePrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    meterBrand: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    meterPrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    acCableBrand: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    acCableSize: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    acCablePrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    dcCableBrand: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    dcCableSize: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    dcCablePrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    acdb: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    acdbPrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    dcdb: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    dcdbPrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    earthingWireSize: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    earthingWireBrand: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    hybridInverter: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    batteryCapacity: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    batteryPrice: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    },
    centralSubsidy: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0
    },
    stateSubsidy: {
      type: DataTypes.DECIMAL(12, 2),
      defaultValue: 0
    },
    pdfUsePanelSizeRange: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    pdfUseInverterBrandOptions: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    pdfCommercialSet: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    pdfPanelRangeKey: {
      type: DataTypes.STRING(80),
      allowNull: true
    },
    pdfDcrPanelRangeKey: {
      type: DataTypes.STRING(80),
      allowNull: true
    },
    pdfNonDcrPanelRangeKey: {
      type: DataTypes.STRING(80),
      allowNull: true
    },
    panelType: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    inaDcrPackage: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    subtotal: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    totalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    finalAmount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true
    }
  },
  {
    sequelize,
    tableName: 'quotation_products',
    timestamps: false,
    freezeTableName: true,
    underscored: false,
    indexes: [
      { fields: ['quotationId'] }
    ]
  }
);

export default QuotationProduct;


