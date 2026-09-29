export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      client_logs: {
        Row: {
          context: Json | null;
          created_at: string;
          device_id: string | null;
          id: string;
          level: string;
          message: string;
          team_id: string | null;
          user_id: string;
        };
        Insert: {
          context?: Json | null;
          created_at?: string;
          device_id?: string | null;
          id?: string;
          level?: string;
          message: string;
          team_id?: string | null;
          user_id?: string;
        };
        Update: {
          context?: Json | null;
          created_at?: string;
          device_id?: string | null;
          id?: string;
          level?: string;
          message?: string;
          team_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_logs_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_logs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      crests: {
        Row: {
          created_at: string;
          created_by: string | null;
          height: number | null;
          id: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          synced_at: string;
          team_id: string;
          width: number | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          height?: number | null;
          id: string;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          synced_at?: string;
          team_id: string;
          width?: number | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          height?: number | null;
          id?: string;
          mime_type?: string;
          size_bytes?: number;
          storage_path?: string;
          synced_at?: string;
          team_id?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "crests_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "crests_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      formation_slots: {
        Row: {
          formation_id: string;
          role: string;
          slot_id: string;
        };
        Insert: {
          formation_id: string;
          role: string;
          slot_id: string;
        };
        Update: {
          formation_id?: string;
          role?: string;
          slot_id?: string;
        };
        Relationships: [];
      };
      match_events: {
        Row: {
          device_id: string;
          event_type: Database["public"]["Enums"]["match_event_type"];
          half: number | null;
          id: string;
          match_id: string;
          match_second: number | null;
          occurred_at: string;
          payload: NonNullable<Json>;
          player_id: string | null;
          received_at: string;
          related_player_id: string | null;
          seq: number;
          slot_id: string | null;
          substitution_id: string | null;
          team_id: string;
          user_id: string;
        };
        Insert: {
          device_id: string;
          event_type: Database["public"]["Enums"]["match_event_type"];
          half?: number | null;
          id: string;
          match_id: string;
          match_second?: number | null;
          occurred_at: string;
          payload?: NonNullable<Json>;
          player_id?: string | null;
          received_at?: string;
          related_player_id?: string | null;
          seq: number;
          slot_id?: string | null;
          substitution_id?: string | null;
          team_id: string;
          user_id: string;
        };
        Update: {
          device_id?: string;
          event_type?: Database["public"]["Enums"]["match_event_type"];
          half?: number | null;
          id?: string;
          match_id?: string;
          match_second?: number | null;
          occurred_at?: string;
          payload?: NonNullable<Json>;
          player_id?: string | null;
          received_at?: string;
          related_player_id?: string | null;
          seq?: number;
          slot_id?: string | null;
          substitution_id?: string | null;
          team_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "match_events_match_id_team_id_fkey";
            columns: ["match_id", "team_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id", "team_id"];
          },
          {
            foreignKeyName: "match_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      match_reports: {
        Row: {
          match_id: string;
          observations: string;
          result: string;
          synced_at: string;
          team_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          match_id: string;
          observations?: string;
          result?: string;
          synced_at?: string;
          team_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          match_id?: string;
          observations?: string;
          result?: string;
          synced_at?: string;
          team_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "match_reports_match_id_team_id_fkey";
            columns: ["match_id", "team_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id", "team_id"];
          },
          {
            foreignKeyName: "match_reports_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      match_squads: {
        Row: {
          match_id: string;
          player_ids: string[];
          synced_at: string;
          team_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          match_id: string;
          player_ids?: string[];
          synced_at?: string;
          team_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          match_id?: string;
          player_ids?: string[];
          synced_at?: string;
          team_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "match_squads_match_id_team_id_fkey";
            columns: ["match_id", "team_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id", "team_id"];
          },
          {
            foreignKeyName: "match_squads_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      matches: {
        Row: {
          control_epoch: number;
          controller_device_id: string | null;
          controller_user_id: string | null;
          created_at: string;
          created_by: string | null;
          crest_id: string | null;
          id: string;
          kickoff_time: string | null;
          last_seq: number;
          location: string | null;
          managed_by: string | null;
          match_date: string | null;
          opponent: string;
          saved_at: string | null;
          season_id: string;
          status: Database["public"]["Enums"]["match_status"];
          synced_at: string;
          team_id: string;
          updated_at: string;
        };
        Insert: {
          control_epoch?: number;
          controller_device_id?: string | null;
          controller_user_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          crest_id?: string | null;
          id: string;
          kickoff_time?: string | null;
          last_seq?: number;
          location?: string | null;
          managed_by?: string | null;
          match_date?: string | null;
          opponent: string;
          saved_at?: string | null;
          season_id: string;
          status?: Database["public"]["Enums"]["match_status"];
          synced_at?: string;
          team_id: string;
          updated_at?: string;
        };
        Update: {
          control_epoch?: number;
          controller_device_id?: string | null;
          controller_user_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          crest_id?: string | null;
          id?: string;
          kickoff_time?: string | null;
          last_seq?: number;
          location?: string | null;
          managed_by?: string | null;
          match_date?: string | null;
          opponent?: string;
          saved_at?: string | null;
          season_id?: string;
          status?: Database["public"]["Enums"]["match_status"];
          synced_at?: string;
          team_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "matches_controller_user_id_fkey";
            columns: ["controller_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "matches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "matches_crest_id_team_id_fkey";
            columns: ["crest_id", "team_id"];
            isOneToOne: false;
            referencedRelation: "crests";
            referencedColumns: ["id", "team_id"];
          },
          {
            foreignKeyName: "matches_managed_by_fkey";
            columns: ["managed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "matches_season_id_team_id_fkey";
            columns: ["season_id", "team_id"];
            isOneToOne: false;
            referencedRelation: "seasons";
            referencedColumns: ["id", "team_id"];
          },
          {
            foreignKeyName: "matches_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      player_match_minutes: {
        Row: {
          match_id: string;
          minutes_played: number;
          player_id: string;
          seconds_played: number;
          started: boolean;
          synced_at: string;
          team_id: string;
          updated_at: string;
        };
        Insert: {
          match_id: string;
          minutes_played: number;
          player_id: string;
          seconds_played: number;
          started: boolean;
          synced_at?: string;
          team_id: string;
          updated_at?: string;
        };
        Update: {
          match_id?: string;
          minutes_played?: number;
          player_id?: string;
          seconds_played?: number;
          started?: boolean;
          synced_at?: string;
          team_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "player_match_minutes_match_id_team_id_fkey";
            columns: ["match_id", "team_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id", "team_id"];
          },
          {
            foreignKeyName: "player_match_minutes_player_id_team_id_fkey";
            columns: ["player_id", "team_id"];
            isOneToOne: false;
            referencedRelation: "players";
            referencedColumns: ["id", "team_id"];
          },
        ];
      };
      players: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          number: number;
          synced_at: string;
          team_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id: string;
          name: string;
          number: number;
          synced_at?: string;
          team_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          number?: number;
          synced_at?: string;
          team_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "players_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "players_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      seasons: {
        Row: {
          created_at: string;
          ends_on: string | null;
          id: string;
          name: string;
          starts_on: string | null;
          synced_at: string;
          team_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          ends_on?: string | null;
          id?: string;
          name: string;
          starts_on?: string | null;
          synced_at?: string;
          team_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          ends_on?: string | null;
          id?: string;
          name?: string;
          starts_on?: string | null;
          synced_at?: string;
          team_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "seasons_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      team_members: {
        Row: {
          created_at: string;
          role: Database["public"]["Enums"]["team_role"];
          team_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          role?: Database["public"]["Enums"]["team_role"];
          team_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          role?: Database["public"]["Enums"]["team_role"];
          team_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      teams: {
        Row: {
          created_at: string;
          current_season_id: string | null;
          id: string;
          name: string;
          synced_at: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          current_season_id?: string | null;
          id?: string;
          name: string;
          synced_at?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          current_season_id?: string | null;
          id?: string;
          name?: string;
          synced_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teams_current_season_fk";
            columns: ["current_season_id", "id"];
            isOneToOne: false;
            referencedRelation: "seasons";
            referencedColumns: ["id", "team_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      append_match_events: { Args: { p_events: Json; p_match_id: string }; Returns: Json };
      server_time: { Args: Record<PropertyKey, never>; Returns: number };
      set_event_time_policy: { Args: { p_max_future_ms: number }; Returns: number };
      take_match_control: {
        Args: { p_event: Json; p_expected_control_epoch: number; p_match_id: string };
        Returns: Json;
      };
    };
    Enums: {
      match_event_type:
        | "SETUP_STARTED"
        | "CONTROL_TAKEN"
        | "LINEUP_CONFIRMED"
        | "MATCH_STARTED"
        | "HALF_STARTED"
        | "PLAYER_OUT"
        | "PLAYER_IN"
        | "SUBSTITUTION_UNDONE"
        | "HALF_ENDED"
        | "MATCH_ENDED"
        | "MATCH_SAVED";
      match_status:
        | "scheduled"
        | "setup"
        | "first_half"
        | "halftime"
        | "second_half"
        | "finished"
        | "saved";
      team_role: "admin" | "coach";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      match_event_type: [
        "SETUP_STARTED",
        "CONTROL_TAKEN",
        "LINEUP_CONFIRMED",
        "MATCH_STARTED",
        "HALF_STARTED",
        "PLAYER_OUT",
        "PLAYER_IN",
        "SUBSTITUTION_UNDONE",
        "HALF_ENDED",
        "MATCH_ENDED",
        "MATCH_SAVED",
      ],
      match_status: [
        "scheduled",
        "setup",
        "first_half",
        "halftime",
        "second_half",
        "finished",
        "saved",
      ],
      team_role: ["admin", "coach"],
    },
  },
} as const;
