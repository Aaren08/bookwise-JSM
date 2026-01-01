import config from "@/lib/config";
import { ImageKitProvider, Video } from "@imagekit/next";

const BookVideo = ({ videoUrl }: { videoUrl: string }) => {
  return (
    <ImageKitProvider urlEndpoint={config.env.imagekit.urlEndpoint}>
      <Video src={videoUrl} controls className="w-full rounded-lg mt-4" />
    </ImageKitProvider>
  );
};

export default BookVideo;
