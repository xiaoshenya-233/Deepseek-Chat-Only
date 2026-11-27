import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

public final class NormalizeApk {
    private NormalizeApk() {
    }

    public static void main(String[] args) throws IOException {
        if (args.length != 2) {
            throw new IllegalArgumentException("Usage: NormalizeApk input.apk output.apk");
        }

        File inputFile = new File(args[0]);
        File outputFile = new File(args[1]);
        Set<String> names = new HashSet<>();

        try (ZipFile input = new ZipFile(inputFile);
             ZipOutputStream output = new ZipOutputStream(new FileOutputStream(outputFile))) {
            var entries = input.entries();
            byte[] buffer = new byte[32768];
            while (entries.hasMoreElements()) {
                ZipEntry source = entries.nextElement();
                String name = source.getName().replace('\\', '/');
                if (!names.add(name)) {
                    throw new IOException("Duplicate APK entry after path normalization: " + name);
                }

                ZipEntry entry = new ZipEntry(name);
                entry.setTime(source.getTime());
                if ("resources.arsc".equals(name)) {
                    entry.setMethod(ZipEntry.STORED);
                    entry.setSize(source.getSize());
                    entry.setCompressedSize(source.getSize());
                    entry.setCrc(source.getCrc());
                } else {
                    entry.setMethod(ZipEntry.DEFLATED);
                }
                output.putNextEntry(entry);
                try (InputStream stream = input.getInputStream(source)) {
                    int count;
                    while ((count = stream.read(buffer)) != -1) {
                        output.write(buffer, 0, count);
                    }
                }
                output.closeEntry();
            }
        }
    }
}
