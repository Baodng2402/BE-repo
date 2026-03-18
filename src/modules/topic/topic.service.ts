import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Groq from 'groq-sdk';
import { Repository } from 'typeorm';
import { Topic } from '../../entities/topic.entity';
import { CreateAiTopicDto } from './dto/create-ai-topic.dto';
import { GenerateTopicIdeaDto } from './dto/generate-topic-idea.dto';

interface GeneratedTopicDraft {
  topic_name: string;
  context: string;
  problem_statement: string;
  primary_actors: string;
  uniqueness_rationale: string;
}

@Injectable()
export class TopicService {
  private groq: Groq;

  constructor(
    @InjectRepository(Topic)
    private readonly topicRepo: Repository<Topic>,
  ) {}

  async getAllTopics(includeTaken = true) {
    if (includeTaken) {
      return this.topicRepo.find({ order: { created_at: 'DESC' } });
    }

    return this.topicRepo.find({
      where: { is_taken: false },
      order: { created_at: 'DESC' },
    });
  }

  async generateTopicIdea(dto: GenerateTopicIdeaDto) {
    const existingTopics = await this.topicRepo.find({
      select: ['name', 'description'],
      order: { created_at: 'DESC' },
      take: 120,
    });

    const existingTopicNames = existingTopics.map((topic) => topic.name);
    const draft = await this.generateDraftWithAi(dto, existingTopicNames);
    const duplicate = await this.isTopicNameTaken(draft.topic_name);

    if (duplicate) {
      throw new BadRequestException(
        'Generated topic duplicated an existing topic. Please regenerate.',
      );
    }

    return {
      ...draft,
      mode: dto.mode,
      duplicate: false,
    };
  }

  async createTopicFromAi(dto: CreateAiTopicDto) {
    const duplicate = await this.isTopicNameTaken(dto.topic_name);
    if (duplicate) {
      throw new BadRequestException(
        'Topic name already exists. Please revise the topic title.',
      );
    }

    const description = this.composeStructuredDescription(dto);
    const topic = this.topicRepo.create({
      name: dto.topic_name.trim(),
      description,
      is_taken: false,
    });

    return this.topicRepo.save(topic);
  }

  async isTopicNameTaken(topicName: string): Promise<boolean> {
    const normalizedInput = this.normalizeTopicName(topicName);
    if (!normalizedInput) {
      return true;
    }

    const existing = await this.topicRepo.find({ select: ['name'] });
    return existing.some(
      (topic) => this.normalizeTopicName(topic.name) === normalizedInput,
    );
  }

  private normalizeTopicName(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ');
  }

  private composeStructuredDescription(dto: CreateAiTopicDto): string {
    return [
      `Context: ${dto.context.trim()}`,
      `Problem: ${dto.problem_statement.trim()}`,
      `Primary Actors: ${dto.primary_actors.trim()}`,
      `Uniqueness Rationale: ${dto.uniqueness_rationale.trim()}`,
    ].join('\n\n');
  }

  private async generateDraftWithAi(
    dto: GenerateTopicIdeaDto,
    existingTopicNames: string[],
  ): Promise<GeneratedTopicDraft> {
    const trimmedSeed = dto.seed_name?.trim();
    const goalLine =
      dto.mode === 'AUTO'
        ? 'Propose a completely new software topic title.'
        : `Refine this student seed topic title while keeping intent: "${trimmedSeed}".`;

    const prompt = `You are an academic software project ideation assistant.
Return ONLY valid JSON with keys: topic_name, context, problem_statement, primary_actors, uniqueness_rationale.

Constraints:
- Topic must be realistic for student capstone scope.
- Topic must be specific and implementable.
- Topic name must not duplicate or closely mirror existing topics.
- Write all fields in concise academic English.

${goalLine}
Additional domain hint: ${dto.project_domain || 'General software engineering'}.
Team context: ${dto.team_context || 'Team of 4-5 students'}.
Problem space hint: ${dto.problem_space || 'No specific constraint'}.
Primary actors hint: ${dto.primary_actors_hint || 'End user, operator, lecturer/admin as needed'}.

Existing topics to avoid:
${JSON.stringify(existingTopicNames)}`;

    try {
      const content = await this.generateWithGroq(prompt);
      const parsed = JSON.parse(content) as GeneratedTopicDraft;

      if (
        !parsed.topic_name ||
        !parsed.context ||
        !parsed.problem_statement ||
        !parsed.primary_actors ||
        !parsed.uniqueness_rationale
      ) {
        throw new Error('AI returned incomplete topic draft');
      }

      return parsed;
    } catch {
      const fallbackName =
        dto.mode === 'REFINE' && trimmedSeed
          ? `${trimmedSeed.trim()} Platform`
          : 'Adaptive Team Collaboration and Progress Intelligence Platform';

      return {
        topic_name: fallbackName,
        context:
          dto.team_context ||
          'Student teams need one workspace to coordinate planning, tasks, and code delivery.',
        problem_statement:
          dto.problem_space ||
          'Teams struggle with fragmented communication and inconsistent progress visibility.',
        primary_actors:
          dto.primary_actors_hint ||
          'Team Leader, Team Members, Lecturer, Teaching Assistant',
        uniqueness_rationale:
          'Combines planning intelligence with repository and delivery signals in one education-focused workflow.',
      };
    }
  }

  private getGroqClient(): Groq {
    if (!this.groq) {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error('Missing GROQ_API_KEY');
      }
      this.groq = new Groq({ apiKey });
    }
    return this.groq;
  }

  private async generateWithGroq(prompt: string): Promise<string> {
    const groqClient = this.getGroqClient();
    const chatCompletion = await groqClient.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama3-70b-8192',
      temperature: 0.45,
    });

    const output = chatCompletion.choices[0]?.message?.content;
    if (!output) {
      throw new Error('Empty response from Groq');
    }

    return output;
  }
}
