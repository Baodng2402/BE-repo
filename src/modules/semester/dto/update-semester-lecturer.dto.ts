import { PartialType } from '@nestjs/mapped-types';
import { CreateSemesterLecturerDto } from './create-semester-lecturer.dto';

export class UpdateSemesterLecturerDto extends PartialType(
  CreateSemesterLecturerDto,
) {}
