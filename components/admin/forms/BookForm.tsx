"use client";

import { useForm, SubmitHandler, FieldErrors } from "react-hook-form";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useRouter } from "next/navigation";
import { bookSchema } from "@/lib/validations";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { BookPlus, BookCheck } from "lucide-react";
import { createBook, updateBook } from "@/lib/admin/actions/book";
import { showErrorToast, showSuccessToast } from "@/lib/essentials/toast-utils";
import { LazyColorPicker, LazyFileUpload } from "@/lib/performance/bundle";
import { useRowLock } from "@/lib/admin/realtime/concurrency/useRowLock";
import { useEffect, useState, useMemo } from "react";

interface Props extends Partial<Book> {
  type: "create" | "update";
  currentAdmin?: AdminActor;
}

type BookFormValues = z.infer<typeof bookSchema>;

// Custom resolver for Zod v4 compatibility
const zodFormResolver = <T extends z.ZodType>(schema: T) => {
  return async (values: unknown) => {
    try {
      const validatedValues = await schema.parseAsync(values);
      return {
        values: validatedValues,
        errors: {},
      };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: FieldErrors = {};

        error.issues.forEach((err: z.core.$ZodIssue) => {
          const path = err.path.join(".");
          if (path) {
            fieldErrors[path] = {
              type: err.code,
              message: err.message,
            };
          }
        });

        return {
          values: {},
          errors: fieldErrors,
        };
      }
      throw error;
    }
  };
};

const BookForm = ({ type, currentAdmin, ...book }: Props) => {
  const router = useRouter();
  const [lockReady, setLockReady] = useState(type === "create");

  const form = useForm<BookFormValues>({
    resolver: zodFormResolver(bookSchema),
    defaultValues: {
      title: book.title || "",
      description: book.description || "",
      author: book.author || "",
      genre: book.genre || "",
      rating: book.rating || 1,
      totalCopies: book.totalCopies || 1,
      coverUrl: book.coverUrl || "",
      coverColor: book.coverColor || "",
      videoUrl: book.videoUrl || "",
      summary: book.summary || "",
    },
  });

  const rowIds = useMemo(() => (book.id ? [book.id] : []), [book.id]);

  const { acquireRowLock, releaseRowLock } = useRowLock({
    entity: "books",
    rowIds,
    currentAdminId: currentAdmin?.id || "",
  });

  useEffect(() => {
    if (type !== "update" || !book.id || !currentAdmin?.id) {
      return;
    }

    let cancelled = false;

    const acquire = async () => {
      const result = await acquireRowLock(book.id as string);

      if (!result.success) {
        if (!cancelled) {
          setLockReady(false);
          showErrorToast(result.message || "Unable to lock book for editing");
        }
        return;
      }

      if (!cancelled) {
        setLockReady(true);
      }
    };

    void acquire();

    return () => {
      cancelled = true;
      void releaseRowLock(book.id as string);
    };
  }, [book.id, currentAdmin?.id, acquireRowLock, releaseRowLock, type]);

  const onSubmit: SubmitHandler<BookFormValues> = async (values) => {
    const result =
      type === "create"
        ? await createBook(values)
        : await updateBook({
            ...values,
            id: book.id as string,
            expectedVersion: book.version as number,
          });

    if (result.success) {
      showSuccessToast(result.message);
      if (result.data?.id) {
        router.push(`/admin/books/${result.data.id}`);
      }
    } else {
      showErrorToast(result.message);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-1">
              <FormLabel className="text-base font-normal text-dark-500">
                Book Title
              </FormLabel>
              <FormControl>
                <Input
                  required
                  placeholder="Book title"
                  {...field}
                  className="book-form_input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="author"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-1">
              <FormLabel className="text-base font-normal text-dark-500">
                Author
              </FormLabel>
              <FormControl>
                <Input
                  required
                  placeholder="Book author"
                  {...field}
                  className="book-form_input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="genre"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-1">
              <FormLabel className="text-base font-normal text-dark-500">
                Genre
              </FormLabel>
              <FormControl>
                <Input
                  required
                  placeholder="Book genre"
                  {...field}
                  className="book-form_input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="rating"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-1">
              <FormLabel className="text-base font-normal text-dark-500">
                Rating
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  required
                  placeholder="Book rating"
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    field.onChange(val === "" ? "" : parseFloat(val));
                  }}
                  className="book-form_input"
                  step="0.1"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="totalCopies"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-1">
              <FormLabel className="text-base font-normal text-dark-500">
                Total Copies
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  required
                  placeholder="Total copies"
                  {...field}
                  value={field.value ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    field.onChange(val === "" ? "" : parseInt(val, 10));
                  }}
                  className="book-form_input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="coverUrl"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-1">
              <FormLabel className="text-base font-normal text-dark-500">
                Book Image
              </FormLabel>
              <FormControl>
                <LazyFileUpload
                  type="image"
                  accept="image/*"
                  placeholder="Upload a book cover"
                  folder="books/covers"
                  variant="light"
                  onUploadComplete={field.onChange}
                  value={field.value}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="coverColor"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-1">
              <FormLabel className="text-base font-normal text-dark-500">
                Primary Color
              </FormLabel>
              <FormControl>
                <LazyColorPicker {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-1">
              <FormLabel className="text-base font-normal text-dark-500">
                Book Description
              </FormLabel>
              <FormControl>
                <Textarea
                  rows={5}
                  required
                  placeholder="Book description"
                  {...field}
                  className="book-form_input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="videoUrl"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-1">
              <FormLabel className="text-base font-normal text-dark-500">
                Book Trailer
              </FormLabel>
              <FormControl>
                <LazyFileUpload
                  type="video"
                  accept="video/*"
                  placeholder="Upload a book trailer"
                  folder="books/videos"
                  variant="light"
                  onUploadComplete={field.onChange}
                  value={field.value}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="summary"
          render={({ field }) => (
            <FormItem className="flex flex-col gap-1">
              <FormLabel className="text-base font-normal text-dark-500">
                Book Summary
              </FormLabel>
              <FormControl>
                <Textarea
                  rows={10}
                  required
                  placeholder="Book summary"
                  {...field}
                  className="book-form_input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          disabled={form.formState.isSubmitting || !lockReady}
          className="book-form_btn cursor-pointer text-white"
        >
          {form.formState.isSubmitting ? (
            <div className="loader-sm" />
          ) : type === "create" ? (
            <BookPlus className="-ml-2 h-4 w-4" />
          ) : (
            <BookCheck className="-ml-2 h-4 w-4" />
          )}
          <p className="ml-2">
            {type === "create" ? "Add Book to Library" : "Update Book"}
          </p>
        </Button>
      </form>
    </Form>
  );
};

export default BookForm;
