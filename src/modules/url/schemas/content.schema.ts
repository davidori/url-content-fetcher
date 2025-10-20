import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ContentDocument = Content & Document;

@Schema({ timestamps: true })
export class Content {
  @Prop({ required: true, unique: true })
  url: string;

  @Prop({ required: true })
  content: string;

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const ContentSchema = SchemaFactory.createForClass(Content);

