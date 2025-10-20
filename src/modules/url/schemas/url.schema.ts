import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type UrlDocument = Url & Document;

@Schema({ timestamps: true })
export class Url {
  @Prop({ required: true, unique: true })
  url: string;

  @Prop({ required: true, enum: ['success', 'error'] })
  status: string;

  @Prop()
  errorMessage?: string;

  @Prop({ type: [String], default: [] })
  redirects: string[];

  @Prop()
  contentType?: string;

  @Prop()
  contentLength?: number;

  @Prop()
  finalUrl?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Content' })
  contentId?: MongooseSchema.Types.ObjectId;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const UrlSchema = SchemaFactory.createForClass(Url);

